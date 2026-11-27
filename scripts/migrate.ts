import { migrate, pool } from '../packages/db/index.js'
try { await migrate(); console.log('Migración aplicada.') } finally { await pool.end() }
