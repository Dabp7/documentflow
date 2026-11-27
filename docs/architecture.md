# Arquitectura

El navegador React consulta la API Express. PostgreSQL guarda solicitudes, jobs, documentos, eventos y la referencia al artefacto. Un proceso worker independiente reclama un job con `FOR UPDATE SKIP LOCKED`, incrementa intento y fencing token, y renueva un lease. Los documentos se leen con cursor `(issued_at,id)` por páginas de 25 y se añaden secuencialmente al ZIP, respetando la contrapresión de los streams.

La solicitud fija `snapshot_at`; solo incluye documentos de su actor creados antes del snapshot, dentro de `[from,until)`. El dataset es inmutable: el seed usa `ON CONFLICT DO NOTHING` y archivos exclusivos. Los documentos posteriores se omiten. No existe una ruta que edite los documentos durante una exportación.

La clave HTTP es única por actor y se compara con el hash del payload normalizado a UTC. El reclamo concurrente y la publicación son invariantes separados. La publicación bloquea el job y la solicitud, verifica token, propietario, lease y estado, mueve un temporal a una clave final única por token y registra el artefacto en la misma transacción. La descarga solo usa la referencia de una solicitud completed.

Cancelar invalida el fencing token y el estado. Un worker cancelado pierde permiso para actualizar progreso y publicar. Ante caída, el lease vence y otro worker reinicia el ZIP; no intenta continuar un archivo parcial. Los temporales interrumpidos se limpian al arrancar si superan una hora. Los errores transitorios tienen hasta tres intentos; un documento inválido falla todo el ZIP y no permite reintento ciego.

Se mantiene como máximo un documento fuente o PDF en memoria, además de buffers de streams y una página Chromium. `MAX_INFLIGHT_BYTES` limita el documento individual; el total de memoria del runtime y de Chromium no equivale a ese límite. `PDF_CONCURRENCY` admite 1–4 como techo; esta versión procesa secuencialmente (concurrencia efectiva 1), por lo que nunca supera el techo configurado.

La API escucha loopback de forma predeterminada. `X-Demo-Actor` solo separa dos identidades ficticias; cualquiera que acceda a la demo puede elegirlas. No es autenticación, autorización empresarial ni un servicio para publicar sin una capa real de acceso. Docker expone sus puertos solo en loopback. Los pagos y los documentos carecen de validez fiscal.

AWS se dejó para una fase futura. El contrato filesystem está aislado en `packages/storage`; no se simula un adaptador S3 inexistente.

El artefacto registra pico RSS del worker (muestreo cada 50 ms) y pico RSS observado del árbol Chromium (consulta al sistema operativo cada segundo). Este último es null en XML o cuando la plataforma impide medirlo. Es un máximo muestreado, no un máximo continuo ni una garantía de memoria; los procesos de observación también añaden trabajo al entorno.
