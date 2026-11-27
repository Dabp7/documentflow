import { StrictMode, useEffect, useRef, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'
type ExportRequest = { id: string; state: string; filters: { from: string; until: string; kind: string; render: string }; processedCount: number; createdAt: string; errorCode: string | null; retryable: boolean; artifact?: { checksum: string; documentCount: number; bytes: string; durationMs: number; peakRssBytes: string } | null; events?: { code: string; toState: string; at: string }[] }
const labels: Record<string, string> = { queued: 'En cola', processing: 'Procesando', completed: 'Lista', failed: 'Falló', cancelled: 'Cancelada' }
async function api(path: string, options?: RequestInit) {
  const response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } })
  const data = await response.json()
  if (!response.ok) throw new Error(`${data.message} (${data.code}; referencia ${data.correlationId})`)
  return data
}
function utcInput(value: string) {
  const [date, time] = value.split('T'); const [year, month, day] = date.split('-').map(Number); const [hour, minute] = time.split(':').map(Number)
  return new Date(Date.UTC(year, month - 1, day, hour, minute)).toISOString()
}
function App() {
  const [items, setItems] = useState<ExportRequest[]>([]); const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [selected, setSelected] = useState<ExportRequest | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('')
  const [from, setFrom] = useState('2026-01-01T00:00'); const [until, setUntil] = useState('2026-01-02T00:00'); const [kind, setKind] = useState('all'); const [render, setRender] = useState('source')
  const selectedId = useRef<string | null>(null); const pendingKey = useRef<{payload: string; key: string} | null>(null)
  async function refresh() {
    const response = await api('/exports'); setItems(response.items); setNextCursor(response.nextCursor)
    if (selectedId.current) setSelected(await api(`/exports/${selectedId.current}`))
    setError(''); setLoading(false)
  }
  useEffect(() => {
    let active = true; let timer: ReturnType<typeof setTimeout>; let delay = 1500
    async function poll() {
      try { if (active) { await refresh(); delay = 1500 } }
      catch (reason) { if (active) { setError((reason as Error).message); setLoading(false); delay = Math.min(delay * 2, 15000) } }
      if (active) timer = setTimeout(poll, delay)
    }
    void poll(); return () => { active = false; clearTimeout(timer) }
  }, [])
  async function create(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setMessage('')
    try {
      const payload = JSON.stringify({ from: utcInput(from), until: utcInput(until), kind, render, format: 'zip' })
      // Keep the same key after a lost response. Change it only after success or a changed selection.
      if (pendingKey.current?.payload !== payload) pendingKey.current = { payload, key: crypto.randomUUID() }
      const created = await api('/exports', { method: 'POST', headers: { 'Idempotency-Key': pendingKey.current.key }, body: payload })
      pendingKey.current = null; selectedId.current = created.id; setSelected(await api(`/exports/${created.id}`)); setMessage('Solicitud registrada. Podés cerrar esta página: el worker continúa.'); await refresh()
    } catch (reason) { setError((reason as Error).message) } finally { setBusy(false) }
  }
  async function show(id: string) { try { selectedId.current = id; setSelected(await api(`/exports/${id}`)) } catch (reason) { setError((reason as Error).message) } }
  async function action(name: string) {
    if (!selected || busy) return; setBusy(true)
    try { await api(`/exports/${selected.id}/${name}`, { method: 'POST' }); await refresh(); setMessage(name === 'cancel' ? 'Solicitud cancelada.' : 'Reintento en cola.') }
    catch (reason) { setError((reason as Error).message) } finally { setBusy(false) }
  }
  const completed = items.filter(item => item.state === 'completed').length
  return <><header><a className="brand" href="#main"><span className="brand-mark">DF</span> DocumentFlow<span className="local-tag">LAB LOCAL</span></a><span className="identity">Cuenta de demo · datos sintéticos</span></header>
    <main id="main"><section className="intro"><div><p className="eyebrow">PROCESAMIENTO DOCUMENTAL</p><h1>Muchos documentos.<br/><span>Una entrega confiable.</span></h1><p>Solicitá una exportación, seguí el proceso y descargá un resultado con conteo y checksum verificables.</p></div><aside className="intro-card"><span>Diseñado para continuar</span><b>Solicitud · Worker · ZIP</b><p>Procesos separados. Recuperación por lease. Almacenamiento local.</p></aside></section>
    <div className="demo-note"><strong>Entorno de demostración.</strong> Los documentos y los importes son ficticios. La identidad de demo no representa autenticación productiva. No requiere AWS.</div>
    {error && <div className="error" role="alert"><span>{error}</span><button onClick={() => void refresh().catch(reason => setError(reason.message))}>Reintentar conexión</button></div>}
    <p className="feedback" role="status">{message}</p>
    <div className="workspace"><section className="panel request-panel"><div className="panel-heading"><span className="section-index">01</span><h2>Nueva exportación</h2></div><form onSubmit={create}>
      <label>Desde · UTC<input type="datetime-local" required value={from} onChange={event => setFrom(event.target.value)}/></label>
      <label>Hasta · UTC, excluyente<input type="datetime-local" required value={until} onChange={event => setUntil(event.target.value)}/></label>
      <p className="hint">Las fechas se interpretan en UTC. El seed comienza el 1 de enero de 2026.</p>
      <label>Tipo de documento<select value={kind} onChange={event => setKind(event.target.value)}><option value="all">Todos los documentos</option><option value="invoice">Facturas de demostración</option><option value="report">Reportes</option></select></label>
      <label>Contenido del ZIP<select value={render} onChange={event => setRender(event.target.value)}><option value="source">XML originales</option><option value="pdf">PDF de plantilla local</option></select></label>
      <button className="primary" type="submit" disabled={busy}>{busy ? 'Registrando…' : 'Crear exportación'}</button><p className="hint">Los reintentos de envío conservan la misma clave. No se duplica la solicitud si se pierde la respuesta.</p>
    </form></section>
    <section className="panel history-panel"><div className="panel-heading"><span className="section-index">02</span><h2>Solicitudes</h2><span className="count">{completed} listas en esta página</span></div>
      {loading ? <div className="empty" role="status">Conectando con el servicio…</div> : !items.length ? <div className="empty"><span className="empty-symbol">ZIP</span><h3>Tu primera entrega empieza acá.</h3><p>Elegí el rango y creá una exportación. El progreso aparecerá en este panel.</p></div> : <div className="requests">{items.map(item => <button className={`request-row ${selected?.id === item.id ? 'selected' : ''}`} key={item.id} onClick={() => void show(item.id)} aria-label={`Ver solicitud ${item.id}`} aria-pressed={selected?.id === item.id}><span className="file-icon">ZIP</span><span className="request-name"><b>{item.filters.render === 'pdf' ? 'Documentos PDF' : 'Documentos XML'}</b><small>{new Date(item.createdAt).toLocaleString('es-GT')} · {item.id.slice(0, 8)}</small></span><span className={`badge ${item.state}`}>{labels[item.state]}</span><span className="document-count">{item.processedCount} docs</span></button>)}</div>}
      {nextCursor && <button className="secondary more" onClick={async () => { try { const result = await api(`/exports?cursor=${encodeURIComponent(nextCursor)}`); setItems(previous => [...previous, ...result.items]); setNextCursor(result.nextCursor) } catch(reason) { setError((reason as Error).message) } }}>Cargar anteriores</button>}
    </section></div>
    <section className="panel detail-panel"><div className="panel-heading"><span className="section-index">03</span><h2>Detalle y evidencia</h2></div>{!selected ? <p className="empty-detail">Seleccioná una solicitud para ver su historia y el resultado.</p> : <div className="detail-grid"><div><span className={`badge ${selected.state}`}>{labels[selected.state]}</span><h3>{selected.id}</h3><p className="hint">Intervalo UTC: {selected.filters.from} hasta {selected.filters.until} (excluyente).</p><div className="actions">{selected.state === 'completed' && <a className="primary" href={`/api/exports/${selected.id}/download`} download>Descargar ZIP</a>}{['queued','processing'].includes(selected.state) && <button className="secondary" disabled={busy} onClick={() => void action('cancel')}>Cancelar exportación</button>}{selected.state === 'failed' && selected.retryable && <button className="primary" disabled={busy} onClick={() => void action('retry')}>Reintentar procesamiento</button>}</div>{selected.errorCode && <p className="error-text">Código: {selected.errorCode}. {selected.retryable ? 'Podés reintentar.' : 'Revisá los datos antes de crear otra solicitud.'}</p>}{selected.artifact && <dl><div><dt>Documentos</dt><dd>{selected.artifact.documentCount}</dd></div><div><dt>Tamaño</dt><dd>{Number(selected.artifact.bytes).toLocaleString()} bytes</dd></div><div><dt>Duración</dt><dd>{selected.artifact.durationMs} ms</dd></div><div><dt>Pico RSS del worker</dt><dd>{(Number(selected.artifact.peakRssBytes)/1048576).toFixed(1)} MiB</dd></div><div className="checksum"><dt>SHA-256</dt><dd>{selected.artifact.checksum}</dd></div></dl>}</div><ol className="timeline">{selected.events?.map((event, index) => <li key={`${event.at}-${index}`}><span>{new Date(event.at).toLocaleTimeString('es-GT')}</span><strong>{labels[event.toState]}</strong><small>{event.code}</small></li>)}</ol></div>}</section>
    <footer><span>DocumentFlow / laboratorio de ingeniería</span><span>Datos propios · almacenamiento filesystem · PostgreSQL</span></footer></main></>
}
createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>)
