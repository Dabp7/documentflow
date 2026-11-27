import { spawn, type ChildProcess } from 'node:child_process'
export function startProcess(entry: string, environment: Record<string, string> = {}) {
  const child = spawn(process.execPath, ['--import', 'tsx', entry], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...environment } })
  let output = ''
  child.stdout?.on('data', chunk => { output += chunk.toString() })
  child.stderr?.on('data', chunk => { output += chunk.toString() })
  return { child, logs: () => output }
}
export async function stopProcess(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM') {
  if (child.exitCode !== null || child.signalCode !== null) return
  const closed = new Promise<void>(resolve => child.once('exit', () => resolve()))
  child.kill(signal)
  await Promise.race([closed, new Promise<void>(resolve => setTimeout(resolve, 5000))])
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
}
export async function waitUntil(check: () => Promise<boolean>, timeout = 60000) {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Condición no alcanzada tras ${timeout} ms`)
}
