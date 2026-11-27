import { describe, it, expect } from 'vitest'
import { filterSchema } from '../../packages/contracts/index.js'
import { payloadHash, decodeCursor, encodeCursor } from '../../packages/domain/index.js'
describe('Contrato documental', () => {
  it('normaliza dos fechas equivalentes con offset para idempotencia', () => {
    const a = filterSchema.parse({ from: '2026-01-01T00:00:00Z', until: '2026-01-02T00:00:00Z' })
    const b = filterSchema.parse({ from: '2025-12-31T18:00:00-06:00', until: '2026-01-01T18:00:00-06:00' })
    expect(payloadHash(a)).toBe(payloadHash(b))
  })
  it('rechaza fecha sin zona, rango invertido y campo extra', () => {
    expect(filterSchema.safeParse({ from: '2026-01-01T00:00', until: '2026-01-02T00:00:00Z' }).success).toBe(false)
    expect(filterSchema.safeParse({ from: '2026-01-03T00:00:00Z', until: '2026-01-02T00:00:00Z' }).success).toBe(false)
    expect(filterSchema.safeParse({ from: '2026-01-01T00:00:00Z', until: '2026-01-02T00:00:00Z', url: 'https://example.org' }).success).toBe(false)
  })
  it('el cursor rechaza estructura manipulada', () => {
    const values = ['2026-01-01T00:00:00Z', 'doc-0000001']
    expect(decodeCursor(encodeCursor(values))).toEqual(values)
    expect(() => decodeCursor('not-json')).toThrow('Cursor inválido')
  })
})
