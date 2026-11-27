import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { pool, transaction } from '../../../packages/db/index.js'
import { AppError, type Filters } from '../../../packages/contracts/index.js'
import { canonicalFilters, payloadHash, decodeCursor, encodeCursor } from '../../../packages/domain/index.js'

export async function requestExport(actor: string, key: string, input: Filters) {
  const filters = canonicalFilters(input)
  const hash = payloadHash(filters)
  return transaction(async client => {
    const inserted = await client.query('INSERT INTO export_requests(id,actor_id,idempotency_key,payload_hash,state,filters_json) VALUES($1,$2,$3,$4,\'queued\',$5) ON CONFLICT(actor_id,idempotency_key) DO NOTHING RETURNING *', [randomUUID(), actor, key, hash, filters])
    const row = inserted.rows[0] ?? (await client.query('SELECT * FROM export_requests WHERE actor_id=$1 AND idempotency_key=$2', [actor, key])).rows[0]
    if (row.payload_hash !== hash) throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'La clave ya pertenece a otra selección de documentos.')
    if (inserted.rowCount) {
      await client.query('INSERT INTO jobs(request_id) VALUES($1)', [row.id])
      await client.query("INSERT INTO job_events(request_id,to_state,code) VALUES($1,'queued','REQUESTED')", [row.id])
    }
    return publicRequest(row)
  })
}
export function publicRequest(row: Record<string, any>) {
  const { id, state, filters_json: filters, created_at: createdAt, processed_count: processedCount, error_code: errorCode, retryable } = row
  return { id, state, filters, createdAt, processedCount, errorCode, retryable }
}
export async function listExports(actor: string, cursor: unknown) {
  const values = decodeCursor(cursor)
  // Document cursors use text IDs; export cursors must satisfy the UUID contract.
  if (values && !z.uuid().safeParse(values[1]).success) throw new AppError(400, 'INVALID_CURSOR', 'Cursor inválido')
  // pg Date values retain milliseconds, while PostgreSQL stores microseconds.
  // Keep the exact database instant in the opaque cursor so nearby rows survive.
  const result = await pool.query(`SELECT *,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at FROM export_requests WHERE actor_id=$1 ${values ? 'AND (created_at,id)<($2::timestamptz,$3::uuid)' : ''} ORDER BY created_at DESC,id DESC LIMIT 21`, values ? [actor, ...values] : [actor])
  const rows = result.rows.slice(0, 20)
  return { items: rows.map(publicRequest), nextCursor: result.rows.length > 20 ? encodeCursor([rows.at(-1).cursor_created_at, rows.at(-1).id]) : null }
}
export async function getExport(actor: string, id: string) {
  const row = (await pool.query('SELECT * FROM export_requests WHERE id=$1 AND actor_id=$2', [id, actor])).rows[0]
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Solicitud no encontrada.')
  const [artifact, events] = await Promise.all([pool.query('SELECT checksum,document_count AS "documentCount",bytes,duration_ms AS "durationMs",peak_rss_bytes AS "peakRssBytes",chromium_peak_rss_bytes AS "chromiumPeakRssBytes",object_key FROM artifacts WHERE request_id=$1', [id]), pool.query('SELECT from_state AS "fromState",to_state AS "toState",code,at FROM job_events WHERE request_id=$1 ORDER BY id', [id])])
  return { ...publicRequest(row), artifact: artifact.rows[0] ? { ...artifact.rows[0], object_key: undefined } : null, events: events.rows }
}
export async function changeExport(actor: string, id: string, action: 'cancel' | 'retry') {
  return transaction(async client => {
    // Every competing transition locks the job before the request, including worker publication.
    await client.query('SELECT request_id FROM jobs WHERE request_id=$1 FOR UPDATE', [id])
    const row = (await client.query('SELECT * FROM export_requests WHERE id=$1 AND actor_id=$2 FOR UPDATE', [id, actor])).rows[0]
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Solicitud no encontrada.')
    if (action === 'cancel') {
      if (!['queued', 'processing'].includes(row.state)) throw new AppError(409, 'INVALID_STATE', 'Solo se puede cancelar una solicitud activa.')
      await client.query("UPDATE export_requests SET state='cancelled',updated_at=now() WHERE id=$1", [id])
      await client.query('UPDATE jobs SET fencing_token=fencing_token+1,lease_owner=NULL,lease_until=NULL WHERE request_id=$1', [id])
      await client.query("INSERT INTO job_events(request_id,from_state,to_state,code) VALUES($1,$2,'cancelled','CANCELLED')", [id, row.state])
    } else {
      if (row.state !== 'failed' || !row.retryable) throw new AppError(409, 'NOT_RETRYABLE', 'La solicitud no admite un reintento. Revisá el error antes de crear otra.')
      await client.query("UPDATE export_requests SET state='queued',error_code=NULL,retryable=false,processed_count=0,updated_at=now() WHERE id=$1", [id])
      await client.query('UPDATE jobs SET attempt=0,fencing_token=fencing_token+1,lease_owner=NULL,lease_until=NULL,next_attempt_at=now() WHERE request_id=$1', [id])
      await client.query("INSERT INTO job_events(request_id,from_state,to_state,code) VALUES($1,'failed','queued','MANUAL_RETRY')", [id])
    }
    return { id, state: action === 'cancel' ? 'cancelled' : 'queued' }
  })
}
