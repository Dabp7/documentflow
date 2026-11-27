# 001 — PostgreSQL y almacenamiento local

Decisión: conservar PostgreSQL real para restricciones, transacciones y leases; usar filesystem para los objetos. SQLite o un mapa en memoria simplificarían el arranque, pero no comprobarían el contrato de reclamo de dos procesos con SKIP LOCKED. S3 añadiría infraestructura y coste antes de comprobar el dominio. Por eso la demo local usa PostgreSQL y los tests de integración crean documentflow_test.

La plantilla PDF es fija y escapa texto. Chromium tiene JavaScript deshabilitado y todas las solicitudes de red abortadas. No hay URLs o HTML aportados por el cliente.

El perfil de Docker deshabilita el sandbox de Chromium dentro del contenedor sin privilegios porque los runners habituales no ofrecen user namespaces compatibles. El perfil local conserva el sandbox. Esta demo solo convierte una plantilla propia y no admite contenido arbitrario.
