import { createHash } from 'node:crypto'
import { AppError, type Filters } from '../contracts/index.js'
export function canonicalFilters(filters: Filters): Filters {
  return { from: new Date(filters.from).toISOString(), until: new Date(filters.until).toISOString(), kind: filters.kind, format: filters.format, render: filters.render }
}
export function payloadHash(filters: Filters) { return createHash('sha256').update(JSON.stringify(canonicalFilters(filters))).digest('hex') }
export function isTransient(error: unknown) {
  return error instanceof Error && ['EIO', 'EBUSY', 'ETIMEDOUT', 'ECONNRESET', '57P01', '40001'].includes((error as NodeJS.ErrnoException).code ?? '')
}
export function encodeCursor(values: unknown[]) { return Buffer.from(JSON.stringify(values)).toString('base64url') }
export function decodeCursor(value: unknown): string[] | null {
  if (value === undefined) return null
  try {
    if (typeof value !== 'string' || value.length > 500) throw new Error()
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString())
    if (!Array.isArray(parsed) || parsed.length !== 2 || parsed.some(x => typeof x !== 'string') || !Number.isFinite(Date.parse(parsed[0])) || !/^[a-zA-Z0-9-]+$/.test(parsed[1])) throw new Error()
    return parsed
  } catch { throw new AppError(400, 'INVALID_CURSOR', 'Cursor inválido') }
}
