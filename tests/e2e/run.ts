import 'dotenv/config'
import { chromium } from 'playwright'
import { mkdir, readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { startProcess, stopProcess, waitUntil } from '../../scripts/process.js'
const api = startProcess('apps/api/src/index.ts', { PORT:'4310' })
const worker = startProcess('apps/worker/src/index.ts')
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
try {
  await waitUntil(async () => { try { return (await fetch('http://127.0.0.1:4310/health')).ok } catch { return false } })
  browser = await chromium.launch({ headless:true })
  await mkdir('test-results', { recursive:true })
  const context = await browser.newContext({ viewport:{width:1440,height:1000}, recordVideo:{dir:'test-results/video',size:{width:1440,height:1000}} })
  const page = await context.newPage(); const errors:string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('http://127.0.0.1:4310/')
  await page.getByRole('heading',{name:'Muchos documentos. Una entrega confiable.'}).waitFor()
  await page.getByLabel('Hasta · UTC, excluyente').fill('2026-01-01T00:11')
  await page.getByRole('button',{name:'Crear exportación',exact:true}).click()
  const downloadLink = page.getByRole('link',{name:'Descargar ZIP',exact:true})
  await downloadLink.waitFor({ timeout:60000 })
  const [download] = await Promise.all([page.waitForEvent('download'),downloadLink.click()])
  const downloadedPath = await download.path(); assert(downloadedPath)
  const bytes = await readFile(downloadedPath); assert.equal(bytes.subarray(0,2).toString(),'PK')
  await page.screenshot({ path:'test-results/desktop.png',fullPage:true })
  await page.setViewportSize({width:390,height:844})
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth<=window.innerWidth),true,'Overflow horizontal en móvil')
  await page.screenshot({path:'test-results/mobile.png',fullPage:true})
  await page.getByRole('button',{name:'Crear exportación',exact:true}).focus()
  assert.equal(await page.getByRole('button',{name:'Crear exportación',exact:true}).evaluate(element=>element===document.activeElement),true)
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({browser:'Chromium',desktop:1440,mobile:390,horizontalOverflow:false,createdViaReact:true,downloadedZipBytes:bytes.length,consoleErrors:errors.length}))
  await context.close()
} catch(error) { console.error(api.logs(),worker.logs()); throw error }
finally { await browser?.close(); await stopProcess(api.child); await stopProcess(worker.child) }
