import { spawn, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
const children: ChildProcess[] = []
for (const args of [['node_modules/tsx/dist/cli.mjs','apps/api/src/index.ts'],['node_modules/tsx/dist/cli.mjs','apps/worker/src/index.ts'],['node_modules/vite/bin/vite.js','--config','apps/web/vite.config.ts']]) {
  const child = spawn(process.execPath, args.map((arg, i) => i === 0 ? resolve(arg) : arg), { stdio: 'inherit', env: process.env, windowsHide: true })
  children.push(child)
  child.on('exit', code => { if (code) { stop(); process.exitCode = code } })
}
function stop() { for (const child of children) child.kill() }
process.once('SIGINT', stop); process.once('SIGTERM', stop)
