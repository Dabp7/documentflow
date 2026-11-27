import 'dotenv/config'
import pg from 'pg'
import { readFile } from 'node:fs/promises'
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://demo:demo@localhost:55432/documentflow', max: 10 })
export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result }
  catch (error) { await client.query('ROLLBACK'); throw error }
  finally { client.release() }
}
export async function migrate() {
  const sql = await readFile(new URL('../../db/migrations/001_initial.sql', import.meta.url), 'utf8')
  await transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(432421)')
    await client.query(sql)
  })
}
