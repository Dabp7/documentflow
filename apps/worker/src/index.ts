import { Worker } from './worker.js'
import { pool } from '../../../packages/db/index.js'
const worker = new Worker()
process.once('SIGINT', () => void worker.stop()); process.once('SIGTERM', () => void worker.stop())
try { await worker.run() } finally { await pool.end() }
