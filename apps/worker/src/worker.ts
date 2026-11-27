import { randomUUID, createHash } from 'node:crypto'
import { Transform, Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { stat, readFile } from 'node:fs/promises'
import yazl from 'yazl'
import puppeteer, { type Browser } from 'puppeteer'
import { pool, transaction } from '../../../packages/db/index.js'
import { isTransient } from '../../../packages/domain/index.js'
import { chromiumRss } from '../../../packages/domain/memory.js'
import { type Filters } from '../../../packages/contracts/index.js'
import { initializeStorage, readObject, writeObject, publishObject, removeObject, objectPath, cleanOldTemporary } from '../../../packages/storage/index.js'

export class LeaseLost extends Error {}
export class InvalidDocument extends Error {}
export type Claim = { request_id: string; fencing_token: number; attempt: number; actor_id: string; filters_json: Filters; snapshot_at: Date }
export async function claimJob(owner: string, leaseSeconds: number): Promise<Claim | null> {
  return transaction(async client => {
    const result = await client.query(`SELECT j.*,r.actor_id,r.filters_json,r.snapshot_at,r.state FROM jobs j JOIN export_requests r ON r.id=j.request_id
      WHERE r.state IN ('queued','processing') AND j.next_attempt_at<=clock_timestamp() AND (j.lease_until IS NULL OR j.lease_until<clock_timestamp())
      ORDER BY j.next_attempt_at,j.request_id FOR UPDATE OF j SKIP LOCKED LIMIT 1`)
    if (!result.rowCount) return null
    const row = result.rows[0]
    // Crashed attempts also count; prevent an endlessly crashing document from occupying the queue forever.
    if (row.attempt >= 3) {
      await client.query("UPDATE export_requests SET state='failed',error_code='ATTEMPTS_EXHAUSTED',retryable=true,updated_at=now() WHERE id=$1", [row.request_id])
      await client.query("INSERT INTO job_events(request_id,from_state,to_state,code) VALUES($1,$2,'failed','ATTEMPTS_EXHAUSTED')", [row.request_id, row.state])
      return null
    }
    const job = (await client.query(`UPDATE jobs SET attempt=attempt+1,fencing_token=fencing_token+1,lease_owner=$2,lease_until=clock_timestamp()+$3*interval '1 second',heartbeat_at=clock_timestamp() WHERE request_id=$1 RETURNING *`, [row.request_id, owner, leaseSeconds])).rows[0]
    await client.query("UPDATE export_requests SET state='processing',processed_count=0,error_code=NULL,updated_at=now() WHERE id=$1", [row.request_id])
    await client.query("INSERT INTO job_events(request_id,from_state,to_state,code) VALUES($1,$2,'processing',$3)", [row.request_id, row.state, row.state === 'processing' ? 'LEASE_RECOVERED' : 'CLAIMED'])
    return { ...row, ...job }
  })
}
export async function heartbeat(claim: Claim, owner: string, leaseSeconds: number) {
  const result = await pool.query(`UPDATE jobs SET lease_until=clock_timestamp()+$4*interval '1 second',heartbeat_at=clock_timestamp()
    WHERE request_id=$1 AND fencing_token=$2 AND lease_owner=$3 AND lease_until>clock_timestamp()`, [claim.request_id, claim.fencing_token, owner, leaseSeconds])
  if (!result.rowCount) throw new LeaseLost('Lease vencido o cancelado')
}
export async function completeJob(claim: Claim, owner: string, artifact: { key: string; checksum: string; count: number; bytes: number; duration: number; peakRss: number; chromiumPeakRss?: number | null }, publish: () => Promise<void>) {
  return transaction(async client => {
    const current = (await client.query('SELECT * FROM jobs WHERE request_id=$1 FOR UPDATE', [claim.request_id])).rows[0]
    const row = (await client.query('SELECT state FROM export_requests WHERE id=$1 FOR UPDATE', [claim.request_id])).rows[0]
    const valid = (await client.query('SELECT $1::timestamptz > clock_timestamp() AS live', [current.lease_until])).rows[0].live
    if (current.fencing_token !== claim.fencing_token || current.lease_owner !== owner || !valid || row.state !== 'processing') throw new LeaseLost('Publicación rechazada por fencing')
    await publish()
    await client.query('INSERT INTO artifacts(request_id,object_key,checksum,document_count,bytes,duration_ms,peak_rss_bytes,chromium_peak_rss_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [claim.request_id, artifact.key, artifact.checksum, artifact.count, artifact.bytes, artifact.duration, artifact.peakRss, artifact.chromiumPeakRss ?? null])
    await client.query("UPDATE export_requests SET state='completed',processed_count=$2,updated_at=now() WHERE id=$1", [claim.request_id, artifact.count])
    await client.query('UPDATE jobs SET lease_until=NULL,lease_owner=NULL WHERE request_id=$1', [claim.request_id])
    await client.query("INSERT INTO job_events(request_id,from_state,to_state,code) VALUES($1,'processing','completed','PUBLISHED')", [claim.request_id])
  })
}
async function failJob(claim: Claim, owner: string, error: unknown) {
  await transaction(async client => {
    const current = (await client.query('SELECT * FROM jobs WHERE request_id=$1 FOR UPDATE', [claim.request_id])).rows[0]
    if (current.fencing_token !== claim.fencing_token || current.lease_owner !== owner) return
    const state = (await client.query('SELECT state FROM export_requests WHERE id=$1 FOR UPDATE', [claim.request_id])).rows[0].state
    if (state !== 'processing') return
    const transient = isTransient(error)
    const retry = transient && claim.attempt < 3
    const code = error instanceof InvalidDocument ? 'INVALID_DOCUMENT' : transient ? 'TRANSIENT_STORAGE_ERROR' : 'PROCESSING_FAILED'
    await client.query('UPDATE export_requests SET state=$2,error_code=$3,retryable=$4,updated_at=now() WHERE id=$1', [claim.request_id, retry ? 'queued' : 'failed', code, transient])
    await client.query("UPDATE jobs SET lease_until=NULL,lease_owner=NULL,next_attempt_at=clock_timestamp()+$2*interval '1 second' WHERE request_id=$1", [claim.request_id, Math.min(30, 2 ** claim.attempt)])
    await client.query("INSERT INTO job_events(request_id,from_state,to_state,code) VALUES($1,'processing',$2,$3)", [claim.request_id, retry ? 'queued' : 'failed', code])
  })
}
function escapeHtml(value: unknown) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!) }
export class Worker {
  readonly owner: string
  private browser: Browser | null = null
  private stopping = false
  constructor(public readonly leaseSeconds = Number(process.env.WORKER_LEASE_SECONDS ?? 15), owner: string = randomUUID(), public readonly documentDelayMs = Number(process.env.DEMO_DOCUMENT_DELAY_MS ?? 0)) {
    this.owner = owner
    if (!Number.isFinite(leaseSeconds) || leaseSeconds < 0.5) throw new Error('WORKER_LEASE_SECONDS debe ser al menos 0.5')
    const concurrency = Number(process.env.PDF_CONCURRENCY ?? 1)
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error('PDF_CONCURRENCY entre 1 y 4')
  }
  async stop() { this.stopping = true }
  async close() { await this.browser?.close(); this.browser = null }
  async run() {
    await initializeStorage(); await cleanOldTemporary()
    try {
      while (!this.stopping) {
        const claim = await claimJob(this.owner, this.leaseSeconds)
        if (claim) await this.process(claim)
        else await new Promise(resolve => setTimeout(resolve, 500))
      }
    } finally { await this.close() }
  }
  async tick() {
    await initializeStorage()
    const claim = await claimJob(this.owner, this.leaseSeconds)
    if (!claim) return null
    await this.process(claim)
    return claim.request_id
  }
  private async pdf(document: any, budget: number) {
    this.browser ??= await puppeteer.launch({ headless: true, args: process.env.CHROMIUM_NO_SANDBOX === '1' ? ['--no-sandbox'] : [] })
    const page = await this.browser.newPage()
    try {
      await page.setJavaScriptEnabled(false)
      await page.setRequestInterception(true)
      page.on('request', request => { void request.abort() })
      await page.setContent(`<html lang="es"><head><meta charset="UTF-8"><style>body{font:16px Arial;padding:40px;color:#18272a}h1{color:#12685c}small{color:#657774}</style></head><body><small>DOCUMENTFLOW · DEMOSTRACIÓN SIN VALIDEZ FISCAL</small><h1>${escapeHtml(document.payload.title)}</h1><p>Referencia: ${escapeHtml(document.id)}</p><p>Fecha UTC: ${escapeHtml(new Date(document.issued_at).toISOString())}</p><p>Importe ficticio: ${escapeHtml(document.payload.amountMinor)} unidades mínimas GTQ</p><p>Generado con datos sintéticos.</p></body></html>`)
      const output = Buffer.from(await page.pdf({ format: 'A4', printBackground: true }))
      if (output.length > budget) throw new InvalidDocument('PDF supera el límite de bytes por documento')
      return output
    } finally { await page.close() }
  }
  async process(claim: Claim) {
    const started = performance.now()
    const tempKey = `temporary/${claim.request_id}-${claim.fencing_token}.zip`
    const finalKey = `artifacts/${claim.request_id}-${claim.fencing_token}.zip`
    const maxBytes = Number(process.env.MAX_INFLIGHT_BYTES ?? 1048576)
    if (!Number.isInteger(maxBytes) || maxBytes < 65536 || maxBytes > 16777216) throw new Error('MAX_INFLIGHT_BYTES entre 65536 y 16777216')
    let count = 0; let totalBytes = 0; let peakRss = process.memoryUsage().rss
    let leaseError: unknown = null; let heartbeatBusy = false
    let chromiumPeakRss: number | null = null; let memoryPending: Promise<void> | null = null
    const sampleChromium = (): Promise<void> => {
      const pid = this.browser?.process()?.pid
      if (!pid) return Promise.resolve()
      if (memoryPending) return memoryPending
      memoryPending = (async () => { const bytes = await chromiumRss(pid); if (bytes !== null) chromiumPeakRss = Math.max(chromiumPeakRss ?? 0, bytes) })().finally(() => { memoryPending = null })
      return memoryPending
    }
    const zip = new yazl.ZipFile()
    const archive = zip.outputStream as Readable
    const hash = createHash('sha256')
    const counter = new Transform({ transform(chunk, _encoding, callback) { totalBytes += chunk.length; hash.update(chunk); callback(null, chunk) } })
    const output = writeObject(tempKey)
    let pipeError: unknown = null
    const writing = pipeline(zip.outputStream, counter, output).catch(error => { pipeError = error })
    const memoryTimer = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss) }, 50)
    const chromiumTimer = setInterval(() => { void sampleChromium() }, 1000)
    const leaseTimer = setInterval(async () => {
      if (heartbeatBusy) return
      heartbeatBusy = true
      try { await heartbeat(claim, this.owner, this.leaseSeconds) }
      catch (error) { leaseError = error; archive.destroy(new LeaseLost('Lease perdido')) }
      finally { heartbeatBusy = false }
    }, Math.max(100, this.leaseSeconds * 1000 / 3))
    try {
      let cursor: [Date, string] | null = null
      while (true) {
        if (leaseError) throw leaseError
        const filters = claim.filters_json
        const params = [claim.actor_id, filters.from, filters.until, claim.snapshot_at, filters.kind, ...(cursor ?? [])]
        const result: { rows: any[]; rowCount: number | null } = await pool.query(`SELECT * FROM documents WHERE owner_id=$1 AND issued_at>=$2 AND issued_at<$3 AND created_at<=$4 AND ($5='all' OR kind=$5) ${cursor ? 'AND (issued_at,id)>($6::timestamptz,$7)' : ''} ORDER BY issued_at,id LIMIT 25`, params)
        if (!result.rowCount) break
        for (const document of result.rows) {
          if (leaseError) throw leaseError
          if (pipeError) throw pipeError
          await heartbeat(claim, this.owner, this.leaseSeconds)
          const metadata = await stat(objectPath(document.object_key)).catch(() => { throw new InvalidDocument('Documento ausente') })
          if (metadata.size !== document.bytes || metadata.size > maxBytes) throw new InvalidDocument('Documento inválido o demasiado grande')
          // Source content is immutable in normal operation. Validate only this bounded document before streaming.
          const source = await readFile(objectPath(document.object_key), 'utf8')
          if (!source.startsWith('<?xml') || !source.endsWith('</document>')) throw new InvalidDocument('Documento XML corrupto')
          const pdf = filters.render === 'pdf' ? await this.pdf(document, maxBytes) : null
          const stream = pdf ? Readable.from(pdf) : readObject(document.object_key)
          await new Promise<void>((resolve, reject) => {
            stream.once('end', resolve); stream.once('error', reject)
            zip.outputStream.once('error', reject)
            zip.addReadStream(stream, `${document.id}.${pdf ? 'pdf' : 'xml'}`)
            stream.once('end', () => zip.outputStream.removeListener('error', reject))
          })
          count++
          await pool.query("UPDATE export_requests SET processed_count=$2,updated_at=now() WHERE id=$1 AND state='processing' AND EXISTS(SELECT 1 FROM jobs WHERE request_id=$1 AND fencing_token=$3 AND lease_owner=$4 AND lease_until>clock_timestamp())", [claim.request_id, count, claim.fencing_token, this.owner])
          cursor = [document.issued_at, document.id]
          if (this.documentDelayMs) await new Promise(resolve => setTimeout(resolve, this.documentDelayMs))
        }
      }
      zip.end(); await writing
      if (pipeError) throw pipeError
      if (leaseError) throw leaseError
      await sampleChromium()
      await completeJob(claim, this.owner, { key: finalKey, checksum: hash.digest('hex'), count, bytes: totalBytes, duration: Math.round(performance.now() - started), peakRss, chromiumPeakRss }, () => publishObject(tempKey, finalKey))
      console.log(JSON.stringify({ event: 'completed', requestId: claim.request_id, documentCount: count, bytes: totalBytes, peakWorkerRssBytes: peakRss, sampledChromiumPeakRssBytes:chromiumPeakRss, durationMs: Math.round(performance.now() - started) }))
    } catch (error) {
      archive.destroy()
      await writing
      if (!(error instanceof LeaseLost)) await failJob(claim, this.owner, error)
      console.error(JSON.stringify({ event: 'job_stopped', requestId: claim.request_id, reason: error instanceof Error ? error.constructor.name : 'Unknown' }))
    } finally {
      clearInterval(leaseTimer); clearInterval(memoryTimer); clearInterval(chromiumTimer)
      await memoryPending
      await removeObject(tempKey)
      // A failed COMMIT response does not prove a rollback. The final object may
      // already be referenced, or become visible after a delayed COMMIT. Keep
      // this fencing-specific key; deleting it here can break a completed export.
    }
  }
}
