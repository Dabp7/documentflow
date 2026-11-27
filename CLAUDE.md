# DocumentFlow

Node 24 LTS; TypeScript estricto; PostgreSQL y filesystem, sin AWS en esta entrega.

Comandos reales: `npm ci`, `npm run db:migrate`, `npm run seed`, `npm run dev`, `npm run verify`, `npm run test:e2e`, `npm run demo:failure`, `npm run benchmark`.

No sustituir PostgreSQL por memoria en las pruebas de concurrencia. Toda transición de worker debe validar fencing, propietario y lease. Bloquear job antes de request. No publicar ZIP parcial. Identidades y documentos son de demo; no agregar secretos ni datos reales. Registrar resultados ejecutados en docs/evidence; no marcar checks que no se corrieron. AWS está aplazado.
