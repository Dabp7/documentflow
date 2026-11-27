# Guion de demostración

1. Ejecutar la instalación limpia del README y abrir el panel. Mostrar el aviso de datos sintéticos y modo local.
2. Elegir el rango UTC 00:00–00:11 del 1 de enero de 2026. Crear XML, observar estados y descargar los diez documentos. Mostrar checksum y abrir el ZIP.
3. Repetir un POST por terminal con Idempotency-Key fijo; comprobar el mismo id. Cambiar un filtro y comprobar 409.
4. Elegir un documento en PDF. Descargar, extraer y abrir el PDF de demostración.
5. Ejecutar `npm run demo:failure`. Mostrar killedRealWorker, recoveredLease y activeArtifacts: 1 en la evidencia JSON.
6. Ejecutar `npm run benchmark`. Mostrar dataset, versión de Node, CPU, memoria del entorno, duración y RSS; no extrapolar a volúmenes no medidos.

Para ver una cancelación en pantalla, iniciar el worker con `DEMO_DOCUMENT_DELAY_MS=100` y seleccionar los 1 000 documentos. Cancelar y comprobar que no existe un enlace de descarga. El worker limpia el temporal cuando detecta el token inválido.

La prueba `npm run test:e2e` genera un video del recorrido y capturas de escritorio/móvil en test-results. Esa carpeta está ignorada porque contiene ejecuciones locales, no resultados del producto.
