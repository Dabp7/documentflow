import pg from 'pg'
export async function ensureTestDatabase() {
if (!process.env.DATABASE_URL?.includes('documentflow_test')) throw new Error('Las pruebas requieren una base con nombre documentflow_test')
const url = new URL(process.env.DATABASE_URL)
const database = url.pathname.slice(1)
if (!/^[a-zA-Z0-9_]+$/.test(database)) throw new Error('Nombre de base no permitido')
url.pathname = '/postgres'
const admin = new pg.Pool({ connectionString: url.toString() })
try {
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])
  if (!exists.rowCount) await admin.query(`CREATE DATABASE "${database}"`)
} finally { await admin.end() }
}
