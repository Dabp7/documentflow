import 'dotenv/config'
import { mkdir, rename, unlink, readdir, stat } from 'node:fs/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import { resolve, sep } from 'node:path'
export const storageRoot = resolve(process.env.STORAGE_ROOT ?? '.data/storage')
export function objectPath(key: string) {
  const path = resolve(storageRoot, key)
  if (!path.startsWith(`${storageRoot}${sep}`)) throw new Error('Invalid storage key')
  return path
}
export async function initializeStorage() { await Promise.all(['sources', 'temporary', 'artifacts'].map(dir => mkdir(objectPath(dir), { recursive: true }))) }
export const readObject = (key: string) => createReadStream(objectPath(key), { highWaterMark: 64 * 1024 })
export const writeObject = (key: string) => createWriteStream(objectPath(key), { flags: 'wx', highWaterMark: 64 * 1024 })
export const publishObject = (from: string, to: string) => rename(objectPath(from), objectPath(to))
export async function removeObject(key: string) { await unlink(objectPath(key)).catch(error => { if (error.code !== 'ENOENT') throw error }) }
export async function cleanOldTemporary(maxAgeMs = 3600000) {
  for (const name of await readdir(objectPath('temporary'))) {
    const key = `temporary/${name}`
    if (Date.now() - (await stat(objectPath(key))).mtimeMs > maxAgeMs) await removeObject(key)
  }
}
