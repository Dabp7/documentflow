import { pool } from '../packages/db/index.js'
import { initializeStorage, objectPath } from '../packages/storage/index.js'
import { writeFile } from 'node:fs/promises'
export async function seed(count = Number(process.env.SEED_COUNT ?? 1000)) {
  if (!Number.isInteger(count) || count < 1 || count > 100000) throw new Error('SEED_COUNT entre 1 y 100000')
  await initializeStorage()
  for (let index = 1; index <= count; index++) {
    const id = `doc-${String(index).padStart(7, '0')}`
    const key = `sources/${id}.xml`
    const kind = index % 2 === 0 ? 'invoice' : 'report'
    const payload = { reference: id, title: `Documento sintético ${index}`, amountMinor: index * 123, currency: 'GTQ' }
    const xml = `<?xml version="1.0" encoding="UTF-8"?><document><reference>${id}</reference><title>${payload.title}</title><amountMinor>${payload.amountMinor}</amountMinor><currency>GTQ</currency></document>`
    await writeFile(objectPath(key), xml, { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error })
    await pool.query('INSERT INTO documents(id,owner_id,kind,issued_at,object_key,bytes,payload) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING', [id, 'demo', kind, new Date(Date.UTC(2026, 0, 1) + index * 60000), key, Buffer.byteLength(xml), payload])
  }
  console.log(`Seed inmutable: ${count} documentos sintéticos del actor demo.`)
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/seed.ts')) { try { await seed() } finally { await pool.end() } }
