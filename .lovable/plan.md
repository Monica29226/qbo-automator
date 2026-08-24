# Estabilizar la importación de Gmail (error 546 por límite de recursos)

## Qué está pasando

La función que baja facturas de Gmail se cae con "no hay suficientes recursos" (546) unas 36 veces al día. Cuando eso ocurre, la sincronización automática también falla (504) y las empresas afectadas —por ejemplo Alturas de Miravalles— dejan de recibir facturas nuevas.

Causa: en una sola ejecución la función acumula hasta 1.000–2.000 mensajes en memoria y luego descarga y decodifica adjuntos (XML y PDF en base64) dentro del mismo proceso. Con buzones grandes el worker excede la memoria disponible y se mata antes de terminar, así que el trabajo de esa corrida se pierde por completo.

## Cambios propuestos

1. Trabajo por tandas con reanudación
   - Reducir el tope por corrida a 150 mensajes (configurable por empresa).
   - Guardar un cursor de avance por empresa (igual que ya se hace con Hostinger/Bluehost) para que la siguiente corrida continúe donde quedó, sin repetir ni perder correos.
   - Devolver `backlog_pending: true` cuando queda trabajo, para que la sincronización automática vuelva a llamar en vez de marcar error.

2. Reducir memoria por mensaje
   - Procesar los mensajes en grupos pequeños y liberar el contenido del adjunto inmediatamente después de subirlo a almacenamiento (no conservar los base64 en un arreglo).
   - Mantener el descarte previo por clave ya existente antes de descargar el PDF (ya implementado) y aplicarlo también al XML.

3. Que la falla no tumbe la sincronización general
   - En `auto-sync-invoices`, tratar 546/504 de una empresa como "parcial" y no como error de toda la corrida: registrar el estado en `sync_logs` y continuar con las demás empresas.

## Detalles técnicos

- `supabase/functions/gmail-fetch-invoices/index.ts`: nuevo tope `GMAIL_BATCH_SIZE` (150), cursor en `system_settings` con clave `gmail_resume_cursor_<org_id>` (id del último mensaje procesado + página), procesamiento en grupos de 5 con liberación explícita de buffers, y respuesta con `backlog_pending` y `processed_count`.
- `supabase/functions/auto-sync-invoices/index.ts`: capturar 546/504 por empresa, marcar `status = 'partial'` con `error_code = 'WORKER_RESOURCE_LIMIT'` y seguir con el resto.
- Sin cambios de esquema salvo el uso de `system_settings` ya existente.

## Verificación

- Ejecutar la importación de Gmail para Alturas de Miravalles y confirmar respuesta 200 con `backlog_pending`.
- Repetir hasta que el cursor llegue al final, verificando que no se creen claves duplicadas.
- Revisar los registros de la función y `sync_logs` durante 24 horas para confirmar 0 respuestas 546.
