# Alcance de la entrega local

Crear una solicitud propia con filtros UTC y clave idempotente; mostrar su progreso; ejecutar el job desde un proceso distinto; descargar un ZIP completo y verificable. Permitir cancelar y reintentar fallos recuperables, rechazar claves reutilizadas con otro payload, impedir acceso cruzado entre los actores de demo y recuperar jobs tras la caída de un worker.

La aceptación automatizada comprueba diez POST concurrentes, dos reclamantes, fencing vencido, ZIP con 10 XML iguales al seed, checksum, PDF real, documento corrupto, cancelación y límites del intervalo. La demo de fallo mata un proceso real, espera el lease y termina con un único artefacto. La prueba de navegador crea, sigue y descarga una solicitud desde React y comprueba layout móvil.

Fuera de alcance: AWS, fiscalidad, autenticación productiva, plantillas arbitrarias, edición del dataset y resultados parciales. Los videos y la evidencia de ejecución se documentan aparte; ninguna medición se declara sin un resultado ejecutado.
