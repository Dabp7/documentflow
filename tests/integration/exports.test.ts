import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest'
import pg from 'pg'
import { type Server } from 'node:http'
import { createHash } from 'node:crypto'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import yauzl from 'yauzl'
import { createApp } from '../../apps/api/src/app.js'
import { pool, migrate } from '../../packages/db/index.js'
import { seed } from '../../scripts/seed.js'
import { Worker, claimJob, completeJob, LeaseLost } from '../../apps/worker/src/worker.js'
import { objectPath } from '../../packages/storage/index.js'
import { ensureTestDatabase } from '../setup-db.js'
let server: Server; let base: string
const workers: Worker[] = []
const filters = { from: '2026-01-01T00:00:00Z', until: '2026-01-01T00:11:00Z', kind: 'all', format: 'zip', render: 'source' }
async function call(path: string, init: RequestInit = {}) {
  const response = await fetch(`${base}/api${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } })
  return { response, data: await response.json() }
}
async function create(key: string = crypto.randomUUID(), payload = filters) { return call('/exports', { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(payload) }) }
function worker(lease = 15, owner?: string, delay = 0) { const value = new Worker(lease, owner, delay); workers.push(value); return value }
async function zipEntries(buffer: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
    if (error || !zip) return reject(error)
    const entries = new Map<string, Buffer>()
    zip.on('error', reject); zip.on('end', () => resolve(entries)); zip.on('entry', entry => zip.openReadStream(entry, (readError, stream) => {
      if (readError || !stream) return reject(readError)
      const chunks: Buffer[] = []; stream.on('data', chunk => chunks.push(chunk)); stream.on('error', reject); stream.on('end', () => { entries.set(entry.fileName, Buffer.concat(chunks)); zip.readEntry() })
    })); zip.readEntry()
  }))
}
beforeAll(async () => {
  await ensureTestDatabase(); await migrate(); await seed(100)
  server = createApp().listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  base = `http://127.0.0.1:${(server.address() as any).port}`
})
beforeEach(async () => { await pool.query('TRUNCATE export_requests CASCADE') })
afterAll(async () => { for (const value of workers) await value.close(); await new Promise<void>(resolve => server.close(() => resolve())); await pool.end() })
describe('API, PostgreSQL real y worker', () => {
  it('lista exactamente 100 documentos sintéticos sin datos de otro actor', async () => {
    expect((await call('/documents')).data.items).toHaveLength(100)
    expect((await call('/documents', { headers: { 'X-Demo-Actor': 'demo-other' } })).data.items).toHaveLength(0)
    expect((await call('/documents?cursor=invalid')).response.status).toBe(400)
  })
  it('diez envíos concurrentes conservan un recurso y detectan conflicto de payload', async () => {
    const key = crypto.randomUUID()
    const requests = await Promise.all(Array.from({ length: 10 }, () => create(key)))
    expect(requests.every(item => item.response.status === 202)).toBe(true)
    expect(new Set(requests.map(item => item.data.id)).size).toBe(1)
    const conflict = await create(key, { ...filters, kind: 'invoice' })
    expect(conflict.response.status).toBe(409)
    expect((await pool.query('SELECT count(*) FROM jobs')).rows[0].count).toBe('1')
  })
  it('pagina sin omitir solicitudes con timestamps distintos en el mismo milisegundo', async () => {
    await Promise.all(Array.from({ length: 25 }, () => create()))
    await pool.query(`WITH numbered AS (SELECT id,row_number() OVER (ORDER BY id) AS position FROM export_requests)
      UPDATE export_requests AS r SET created_at='2026-01-01T00:00:00.123000Z'::timestamptz + numbered.position * interval '1 microsecond'
      FROM numbered WHERE r.id=numbered.id`)
    const first = (await call('/exports')).data
    expect(first.items).toHaveLength(20)
    expect(first.nextCursor).not.toBeNull()
    const second = (await call(`/exports?cursor=${encodeURIComponent(first.nextCursor)}`)).data
    expect(second.items).toHaveLength(5)
    expect(new Set([...first.items, ...second.items].map((item: any) => item.id)).size).toBe(25)
  })
  it('rechaza con 400 un cursor de solicitudes con UUID inválido y conserva IDs textuales de documentos', async () => {
    const cursor = Buffer.from(JSON.stringify(['2026-01-01T00:00:00Z', 'not-a-uuid'])).toString('base64url')
    const result = await call(`/exports?cursor=${cursor}`)
    expect(result.response.status).toBe(400)
    expect(result.data.code).toBe('INVALID_CURSOR')
    const documentCursor = Buffer.from(JSON.stringify(['2026-01-01T00:01:00Z', 'doc-0000001'])).toString('base64url')
    const documents = await call(`/documents?cursor=${documentCursor}`)
    expect(documents.response.status).toBe(200)
    expect(documents.data.items).toHaveLength(99)
    expect(documents.data.items[0].id).toBe('doc-0000002')
  })
  it('dos workers reclaman un solo propietario y publican un ZIP de 10 XML verificados', async () => {
    const request = (await create()).data
    const one = worker(15, 'one'); const two = worker(15, 'two')
    const claims = await Promise.all([claimJob(one.owner, 15), claimJob(two.owner, 15)])
    expect(claims.filter(Boolean)).toHaveLength(1)
    const index = claims[0] ? 0 : 1; await [one, two][index].process(claims[index]!)
    const response = await fetch(`${base}/api/exports/${request.id}/download`)
    const bytes = Buffer.from(await response.arrayBuffer())
    expect(response.status).toBe(200)
    expect(response.headers.get('X-Content-SHA256')).toBe(createHash('sha256').update(bytes).digest('hex'))
    const entries = await zipEntries(bytes); expect(entries.size).toBe(10)
    expect(entries.get('doc-0000001.xml')).toEqual(await readFile(objectPath('sources/doc-0000001.xml')))
    expect((await pool.query('SELECT count(*) FROM artifacts WHERE request_id=$1', [request.id])).rows[0].count).toBe('1')
    expect((await call(`/exports/${request.id}`)).data.state).toBe('completed')
  })
  it('un worker vencido no publica después de que otro recupera el lease', async () => {
    const request = (await create()).data
    const old = await claimJob('old-worker', 0.5)
    await new Promise(resolve => setTimeout(resolve, 700))
    const recovered = await claimJob('new-worker', 15)
    expect(recovered?.fencing_token).toBeGreaterThan(old!.fencing_token)
    await expect(completeJob(old!, 'old-worker', { key: 'never', checksum: 'x', count: 0, bytes: 0, duration: 0, peakRss: 0 }, async () => { throw new Error('No debe publicar') })).rejects.toBeInstanceOf(LeaseLost)
    await worker(15, 'new-worker').process(recovered!)
    const detail = (await call(`/exports/${request.id}`)).data
    expect(detail.state).toBe('completed'); expect(detail.events.some((event: any) => event.code === 'LEASE_RECOVERED')).toBe(true)
  })
  it('conserva el ZIP confirmado si se pierde el ack del COMMIT de publicación', async () => {
    const request = (await create()).data
    const query = pg.Client.prototype.query
    const publishing = new WeakSet<pg.Client>()
    let lostAcknowledgement = false
    // Commit against real PostgreSQL, then simulate losing only its response.
    // This exercises worker cleanup after a successfully committed publication.
    const injected = vi.spyOn(pg.Client.prototype, 'query').mockImplementation(function (this: pg.Client, ...args: any[]) {
      const result = (query as any).apply(this, args)
      if (typeof args[0] === 'string' && args[0].startsWith('INSERT INTO artifacts(')) publishing.add(this)
      if (args[0] === 'COMMIT' && publishing.has(this) && !lostAcknowledgement) {
        return (result as Promise<unknown>).then(() => {
          lostAcknowledgement = true
          throw Object.assign(new Error('COMMIT acknowledgement lost'), { code: 'ECONNRESET' })
        })
      }
      return result
    } as any)
    try { await worker().tick() } finally { injected.mockRestore() }
    expect(lostAcknowledgement).toBe(true)
    const detail = (await call(`/exports/${request.id}`)).data
    expect(detail.state).toBe('completed')
    const response = await fetch(`${base}/api/exports/${request.id}/download`)
    expect(response.status).toBe(200)
    const bytes = Buffer.from(await response.arrayBuffer())
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(detail.artifact.checksum)
    expect((await zipEntries(bytes)).size).toBe(10)
  })
  it('cancelar durante procesamiento impide la descarga y limpia el temporal', async () => {
    const request = (await create()).data
    const active = worker(1, 'cancel-worker', 100)
    const claim = await claimJob(active.owner, 1)
    const processing = active.process(claim!)
    await new Promise(resolve => setTimeout(resolve, 160))
    expect((await call(`/exports/${request.id}/cancel`, { method: 'POST' })).response.status).toBe(202)
    await processing
    expect((await call(`/exports/${request.id}`)).data.state).toBe('cancelled')
    expect((await fetch(`${base}/api/exports/${request.id}/download`)).status).toBe(409)
    expect((await readdir(objectPath('temporary'))).some(name => name.startsWith(request.id))).toBe(false)
  })
  it('un XML corrupto falla completo, sin ZIP descargable ni reintento ciego', async () => {
    const key = objectPath('sources/doc-0000001.xml'); const original = await readFile(key)
    try {
      await writeFile(key, 'corrupto')
      const request = (await create()).data; await worker().tick()
      const detail = (await call(`/exports/${request.id}`)).data
      expect(detail.state).toBe('failed'); expect(detail.errorCode).toBe('INVALID_DOCUMENT')
      expect((await call(`/exports/${request.id}/retry`, { method: 'POST' })).response.status).toBe(409)
      expect((await fetch(`${base}/api/exports/${request.id}/download`)).status).toBe(409)
    } finally { await writeFile(key, original) }
  })
  it('no filtra metadatos, cancelación ni descargas de otra identidad de demo', async () => {
    const request = (await create()).data
    const options = { headers: { 'X-Demo-Actor': 'demo-other' } }
    expect((await call(`/exports/${request.id}`, options)).response.status).toBe(404)
    expect((await call(`/exports/${request.id}/cancel`, { ...options, method: 'POST' })).response.status).toBe(404)
    expect((await fetch(`${base}/api/exports/${request.id}/download`, options)).status).toBe(404)
  })
  it('dos reintentos manuales concurrentes crean un solo intento activo', async () => {
    const request = (await create()).data
    await pool.query("UPDATE export_requests SET state='failed',retryable=true,error_code='TRANSIENT_STORAGE_ERROR' WHERE id=$1",[request.id])
    const retries = await Promise.all([call(`/exports/${request.id}/retry`,{method:'POST'}),call(`/exports/${request.id}/retry`,{method:'POST'})])
    expect(retries.map(result=>result.response.status).sort()).toEqual([202,409])
    await worker().tick()
    expect((await call(`/exports/${request.id}`)).data.state).toBe('completed')
    expect((await pool.query('SELECT count(*) FROM artifacts WHERE request_id=$1',[request.id])).rows[0].count).toBe('1')
  })
  it('respeta [desde,hasta), admite cero resultados y no incorpora documentos después del snapshot', async () => {
    const request = (await create(undefined, { ...filters, from: '2026-01-01T00:01:00Z', until: '2026-01-01T00:02:00Z' })).data
    await new Promise(resolve => setTimeout(resolve, 20))
    await pool.query("INSERT INTO documents(id,owner_id,kind,issued_at,object_key,bytes,payload) SELECT 'late-after-snapshot',owner_id,kind,issued_at,object_key,bytes,payload FROM documents WHERE id='doc-0000001'")
    try {
      await worker().tick()
      expect((await call(`/exports/${request.id}`)).data.artifact.documentCount).toBe(1)
    } finally { await pool.query("DELETE FROM documents WHERE id='late-after-snapshot'") }
    const empty = (await create(undefined, { ...filters, from: '2027-01-01T00:00:00Z', until: '2027-01-02T00:00:00Z' })).data
    await worker().tick()
    expect((await call(`/exports/${empty.id}`)).data.artifact.documentCount).toBe(0)
  })
  it('genera PDF real desde una plantilla local y lo entrega dentro del ZIP', async () => {
    const request = (await create(undefined, { ...filters, from: '2026-01-01T00:01:00Z', until: '2026-01-01T00:02:00Z', render: 'pdf' })).data
    await worker().tick()
    const response = await fetch(`${base}/api/exports/${request.id}/download`)
    expect(response.status).toBe(200)
    const entries = await zipEntries(Buffer.from(await response.arrayBuffer()))
    expect(entries.get('doc-0000001.pdf')?.subarray(0, 5).toString()).toBe('%PDF-')
  })
})
