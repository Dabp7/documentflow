# Evidencia de verificación — 2026-11-27

Entorno: Windows 10 x64, Node 22.15.0, npm 10.9.2, PostgreSQL 17.12 real en loopback. La aplicación recomienda Node 24 LTS y el workflow usa esa versión.

- `npm ci --ignore-scripts --no-audit --no-fund`: instalación limpia reproducida después de fijar versiones; Puppeteer y Chromium ya estaban descargados por la instalación original con scripts.
- `npm run build`: TypeScript estricto y Vite completados.
- `npm test`: tres casos de contrato, fechas equivalentes y cursor inválido pasaron.
- `npm run verify`: build, tres tests unitarios y diez tests de integración pasaron con Vitest 4.1.12. PostgreSQL real, idempotencia concurrente, reclamo de dos workers, fencing vencido, cancelación, documento corrupto, aislamiento por actor, reintento concurrente, fechas/snapshot, ZIP verificado y PDF real.
- `npm run test:e2e`: creación desde React, estado completed y descarga ZIP de 2 700 bytes; Chromium a 1440 px y 390 px; sin overflow horizontal ni errores de página. Las capturas se revisaron visualmente.
- `npm run demo:failure`: proceso real terminado con SIGKILL, lease recuperado por otro worker y exactamente un artefacto. Resultado reproducido en `failure-demo.json`.
- `npm run benchmark`: 1 000 documentos XML, ZIP de 270 688 bytes, 7 604 ms, pico RSS del worker 113 807 360 bytes. Dataset, CPU y entorno en `benchmark.json`; no extrapolar a volúmenes no medidos.
- `npm audit --json`: cero vulnerabilidades reportadas con Vitest 4.1.12 y yauzl 3.4.0 fijados.

El recorrido de navegador y el benchmark usan datos sintéticos. El video fue generado por Playwright durante el flujo real. Docker Compose y el workflow Linux se entregan configurados; no se ejecutaron en esta máquina porque Docker no está instalado. AWS se aplazó por decisión del usuario.

Los procesos hijos y servidores de las pruebas se detuvieron al finalizar. El servidor PostgreSQL portable compartido pertenece al entorno de verificación y no se incluye como dependencia binaria del repositorio.
