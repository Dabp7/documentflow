import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const exec = promisify(execFile)
/** OS RSS for a dedicated Chromium process tree. Does not inspect command lines or file contents. */
export async function chromiumRss(rootPid: number): Promise<number | null> {
  try {
    let processes: { pid: number; parent: number; bytes: number }[]
    if (process.platform === 'win32') {
      const { stdout } = await exec('powershell.exe', ['-NoProfile','-NonInteractive','-Command','Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize | ConvertTo-Json -Compress'], { windowsHide: true, timeout: 5000, maxBuffer: 1024 * 1024 })
      const rows = JSON.parse(stdout)
      processes = (Array.isArray(rows) ? rows : [rows]).map(row => ({ pid: Number(row.ProcessId), parent: Number(row.ParentProcessId), bytes: Number(row.WorkingSetSize) }))
    } else {
      const { stdout } = await exec('ps', ['-e','-o','pid=,ppid=,rss='], { timeout:5000, maxBuffer:1024*1024 })
      processes = stdout.trim().split('\n').map(line => { const [pid,parent,rss] = line.trim().split(/\s+/).map(Number); return {pid,parent,bytes:rss*1024} })
    }
    const descendants = new Set([rootPid])
    let changed = true
    while(changed) { changed = false; for(const process of processes) if(descendants.has(process.parent) && !descendants.has(process.pid)) { descendants.add(process.pid); changed = true } }
    const selected = processes.filter(process => descendants.has(process.pid))
    return selected.length ? selected.reduce((total,process) => total+process.bytes,0) : null
  } catch { return null }
}
