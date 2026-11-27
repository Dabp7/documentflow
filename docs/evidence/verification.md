# Evidencia de verificación — 2026-11-27

Entorno: Windows 10 x64, Node 22.15.0, npm 10.9.2, PostgreSQL 17.12 real en loopback. La aplicación recomienda Node 24 LTS y el workflow usa esa versión.

- `npm ci --ignore-scripts --no-audit --no-fund`: instalación limpia reproducida después de fijar versiones; Puppeteer y Chromium ya estaban descargados por la instalación original con scripts.
- `npm run build`: TypeScript estricto y Vite completados.
- `npm test`: tres casos de contrato, fechas equivalentes y cursor inválido pasaron.
- `npm run verify`: build, tres tests unitarios y trece tests de integración pasaron con Vitest 4.1.12. PostgreSQL real, idempotencia concurrente, reclamo de dos workers, fencing vencido, cancelación, documento corrupto, aislamiento por actor, reintento concurrente, fechas/snapshot, ZIP verificado, PDF real y las regresiones de revisión independiente descritas abajo.
- `npm run test:e2e`: creación desde React, estado completed y descarga ZIP de 2 700 bytes; Chromium a 1440 px y 390 px; sin overflow horizontal ni errores de página. Las capturas se revisaron visualmente.
- `npm run demo:failure`: proceso real terminado con SIGKILL, lease recuperado por otro worker y exactamente un artefacto. Resultado reproducido en `failure-demo.json`.
- `npm run benchmark`: 1 000 documentos XML, ZIP de 270 688 bytes, 7 604 ms, pico RSS del worker 113 807 360 bytes. Dataset, CPU y entorno en `benchmark.json`; no extrapolar a volúmenes no medidos.
- `npm audit --json`: cero vulnerabilidades reportadas con Vitest 4.1.12 y yauzl 3.4.0 fijados.

El recorrido de navegador y el benchmark usan datos sintéticos. El video fue generado por Playwright durante el flujo real. Docker Compose y el workflow Linux se entregan configurados; no se ejecutaron en esta máquina porque Docker no está instalado. AWS se aplazó por decisión del usuario.

Los procesos hijos y servidores de las pruebas se detuvieron al finalizar. El servidor PostgreSQL portable compartido pertenece al entorno de verificación y no se incluye como dependencia binaria del repositorio.

## Revisión independiente de integridad

- Se reprodujo un COMMIT real de publicación confirmado por PostgreSQL y se inyectó la pérdida de su respuesta antes de que llegara al worker. Antes de la corrección, la solicitud quedaba completed pero el cleanup borraba el ZIP y la descarga devolvía 500. La regresión comprueba conservación del archivo, descarga 200, checksum y diez entradas después de ese fallo de comunicación.
- Se reprodujo la omisión de solicitudes al paginar 25 timestamps distintos dentro del mismo milisegundo: el cursor basado en Date de JavaScript devolvía 20 registros y después cero. El cursor ahora conserva los seis decimales del timestamp SQL; la prueba exige páginas de 20 y cinco y 25 IDs únicos.
- Un cursor de solicitudes con ID no UUID devolvía 500 por el cast de PostgreSQL. Ahora devuelve 400/INVALID_CURSOR antes de consultar; la regresión también comprueba que los cursores de documentos siguen aceptando IDs textuales y recorren las 99 filas posteriores a doc-0000001.
- Ante resultado ambiguo tras rename se conserva la clave final única por fencing, sin inferir rollback de una consulta que todavía no vea artifacts. Puede quedar un archivo final huérfano si el COMMIT realmente se revierte; no se ofrece por la API. La limpieza diferida exige certeza y no se agregó un recolector en esta corrección. Los temporales privados siguen limpiándose.
