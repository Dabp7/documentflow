import { z } from 'zod'

export const filterSchema = z.object({
  from: z.iso.datetime({ offset: true }),
  until: z.iso.datetime({ offset: true }),
  kind: z.enum(['all', 'invoice', 'report']).default('all'),
  format: z.literal('zip').default('zip'),
  render: z.enum(['source', 'pdf']).default('source'),
}).strict().refine(value => Date.parse(value.from) < Date.parse(value.until), 'El fin debe ser posterior al inicio')
export type Filters = z.infer<typeof filterSchema>
export type State = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'
export class AppError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}
