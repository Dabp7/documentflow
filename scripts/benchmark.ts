import { randomUUID } from 'node:crypto'
import { writeFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import { pool, migrate } from '../packages/db/index.js'
import { seed } from './seed.js'
import { requestExport, getExport } from '../apps/api/src/service.js'
import { startProcess, stopProcess, waitUntil } from './process.js'
const count = Number(process.env.SEED_COUNT ?? 1000)
await migrate(); await seed(count)
const request = await requestExport('demo', `benchmark-${randomUUID()}`, { from:'2026-01-01T00:00:00Z', until: new Date(Date.UTC(2026, 0, 1) + (count + 1) * 60000).toISOString(), kind:'all', format:'zip', render:'source' })
const processWorker = startProcess('apps/worker/src/index.ts')
try {
  await waitUntil(async () => ['completed','failed'].includes((await getExport('demo', request.id)).state), 300000)
  const detail = await getExport('demo', request.id)
  if (detail.state !== 'completed') throw new Error(`Benchmark falló: ${detail.errorCode}`)
  const report = { command:'npm run benchmark', at:new Date().toISOString(), node:process.version, os:`${os.platform()} ${os.release()} ${os.arch()}`, cpu:os.cpus()[0].model, totalMemoryBytes:os.totalmem(), datasetDocuments:count, render:'source', workerProcessSeparated:true, chromiumRss:'not_applicable_source_xml', result:detail.artifact }
  await mkdir('docs/evidence', { recursive:true }); await writeFile('docs/evidence/benchmark.json',JSON.stringify(report,null,2)); console.log(JSON.stringify(report,null,2))
} finally { await stopProcess(processWorker.child); await pool.end() }
