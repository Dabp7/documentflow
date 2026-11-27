import { createApp } from './app.js'
import { pool } from '../../../packages/db/index.js'
const port = Number(process.env.PORT ?? 4300)
const host = process.env.HOST ?? '127.0.0.1'
const server = createApp().listen(port, host, () => console.log(`DocumentFlow API http://${host}:${port} · datos y autenticación simulados`))
async function shutdown() { server.close(async () => { await pool.end(); process.exit(0) }) }
process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown)
