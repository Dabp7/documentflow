import express, { type ErrorRequestHandler } from 'express'
import helmet from 'helmet'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { stat } from 'node:fs/promises'
import { z } from 'zod'
import { filterSchema, AppError } from '../../../packages/contracts/index.js'
import { decodeCursor, encodeCursor } from '../../../packages/domain/index.js'
import { pool } from '../../../packages/db/index.js'
import { objectPath } from '../../../packages/storage/index.js'
import { requestExport, listExports, getExport, changeExport } from './service.js'
export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.use(helmet({ contentSecurityPolicy: { directives: { 'script-src': ["'self'"], 'style-src': ["'self'", "'unsafe-inline'"], 'connect-src': ["'self'"] } } }))
  app.use((req, res, next) => { res.locals.correlationId = randomUUID(); res.setHeader('X-Correlation-Id', res.locals.correlationId); next() })
  app.use(express.json({ limit: '10kb' }))
  app.use('/api', (req, res, next) => {
    const actor = req.get('X-Demo-Actor') ?? process.env.DEMO_ACTOR_ID ?? 'demo'
    if (!['demo', 'demo-other'].includes(actor)) return next(new AppError(401, 'UNKNOWN_DEMO_ACTOR', 'Usá una identidad de demostración válida.'))
    res.locals.actor = actor
    next()
  })
  app.get('/health', async (_req, res) => { await pool.query('SELECT 1'); res.json({ status: 'ok', mode: 'local-demo' }) })
  app.get('/api/documents', async (req, res) => {
    const cursor = decodeCursor(req.query.cursor)
    const result = await pool.query(`SELECT id,kind,issued_at AS "issuedAt",bytes,payload FROM documents WHERE owner_id=$1 ${cursor ? 'AND (issued_at,id)>($2::timestamptz,$3)' : ''} ORDER BY issued_at,id LIMIT 101`, cursor ? [res.locals.actor, ...cursor] : [res.locals.actor])
    const items = result.rows.slice(0, 100)
    res.json({ items, nextCursor: result.rows.length > 100 ? encodeCursor([items.at(-1).issuedAt.toISOString(), items.at(-1).id]) : null })
  })
  app.post('/api/exports', async (req, res) => {
    const key = req.get('Idempotency-Key')
    if (!key || !/^[a-zA-Z0-9_-]{1,128}$/.test(key)) throw new AppError(400, 'INVALID_IDEMPOTENCY_KEY', 'Enviá Idempotency-Key de 1 a 128 letras, números, guiones o guiones bajos.')
    const result = filterSchema.safeParse(req.body)
    if (!result.success) throw new AppError(400, 'INVALID_FILTERS', 'Revisá las fechas con zona horaria, tipo y formato. El intervalo es [desde, hasta).')
    res.status(202).json(await requestExport(res.locals.actor, key, result.data))
  })
  app.get('/api/exports', async (req, res) => res.json(await listExports(res.locals.actor, req.query.cursor)))
  app.param('id', (_req, _res, next, id) => { if (!z.uuid().safeParse(id).success) next(new AppError(404, 'NOT_FOUND', 'Solicitud no encontrada.')); else next() })
  app.get('/api/exports/:id', async (req, res) => res.json(await getExport(res.locals.actor, req.params.id)))
  app.post('/api/exports/:id/cancel', async (req, res) => res.status(202).json(await changeExport(res.locals.actor, req.params.id, 'cancel')))
  app.post('/api/exports/:id/retry', async (req, res) => res.status(202).json(await changeExport(res.locals.actor, req.params.id, 'retry')))
  app.get('/api/exports/:id/download', async (req, res) => {
    const request = await getExport(res.locals.actor, req.params.id)
    if (request.state !== 'completed') throw new AppError(409, 'NOT_READY', 'El archivo todavía no está disponible.')
    const artifact = (await pool.query('SELECT object_key,checksum FROM artifacts WHERE request_id=$1', [req.params.id])).rows[0]
    if (!artifact) throw new AppError(404, 'ARTIFACT_NOT_FOUND', 'Resultado no encontrado.')
    res.setHeader('X-Content-SHA256', artifact.checksum)
    // STORAGE_ROOT may be .data; allow this known private root only after actor/state checks.
    res.download(objectPath(artifact.object_key), `documentflow-${req.params.id}.zip`, { dotfiles: 'allow' })
  })
  app.use('/api', (_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Ruta no encontrada.')))
  const web = resolve('apps/web/dist')
  app.use(express.static(web))
  app.get('/', async (_req, res) => { await stat(resolve(web, 'index.html')); res.sendFile(resolve(web, 'index.html')) })
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    const status = error instanceof AppError ? error.status : error.status === 400 || error.status === 413 ? error.status : 500
    const code = error.code && status < 500 ? error.code : status === 413 ? 'PAYLOAD_TOO_LARGE' : status === 400 ? 'INVALID_JSON' : 'INTERNAL_ERROR'
    if (status === 500) console.error(JSON.stringify({ code, correlationId: res.locals.correlationId, error: error.name }))
    res.status(status).json({ code, message: status < 500 ? error.message : 'No se pudo completar la operación.', correlationId: res.locals.correlationId })
  }
  app.use(errors)
  return app
}
