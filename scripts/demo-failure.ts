import { randomUUID } from 'node:crypto'
import { pool, migrate } from '../packages/db/index.js'
import { seed } from './seed.js'
import { requestExport, getExport } from '../apps/api/src/service.js'
import { startProcess, stopProcess, waitUntil } from './process.js'
import { writeFile, mkdir } from 'node:fs/promises'
await migrate(); await seed(100)
const request = await requestExport('demo', `failure-${randomUUID()}`, { from:'2026-01-01T00:00:00Z', until:'2026-01-01T00:11:00Z', kind:'all', format:'zip', render:'source' })
let first: ReturnType<typeof startProcess> | undefined; let second: ReturnType<typeof startProcess> | undefined
try {
  first = startProcess('apps/worker/src/index.ts', { WORKER_LEASE_SECONDS: '1', DEMO_DOCUMENT_DELAY_MS: '200' })
  await waitUntil(async () => { const result = await pool.query('SELECT state,processed_count FROM export_requests WHERE id=$1', [request.id]); return result.rows[0].state === 'processing' && result.rows[0].processed_count >= 1 })
  await stopProcess(first.child, 'SIGKILL')
  await new Promise(resolve => setTimeout(resolve, 1300))
  second = startProcess('apps/worker/src/index.ts', { WORKER_LEASE_SECONDS: '1' })
  await waitUntil(async () => (await getExport('demo', request.id)).state === 'completed')
  const detail = await getExport('demo', request.id)
  const artifacts = (await pool.query('SELECT count(*) FROM artifacts WHERE request_id=$1', [request.id])).rows[0].count
  if (artifacts !== '1' || !detail.events.some(event => event.code === 'LEASE_RECOVERED')) throw new Error('No se demostró la recuperación con artefacto único')
  const evidence = { command: 'npm run demo:failure', at: new Date().toISOString(), requestId: request.id, killedRealWorker: true, recoveredLease: true, activeArtifacts: Number(artifacts), result: detail }
  await mkdir('docs/evidence', { recursive: true }); await writeFile('docs/evidence/failure-demo.json', JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify(evidence, null, 2))
} finally { if (first) await stopProcess(first.child); if (second) await stopProcess(second.child); await pool.end() }
