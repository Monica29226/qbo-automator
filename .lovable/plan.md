
# Plan: recuperación de Terranoa + chunking de Hostinger + alertas correctas por servicio

## Contexto del diagnóstico

- Última sincronización exitosa de **Terranoa**: `2026-04-28 12:30` UTC. Mayo entero sin actividad. El cron sigue activo para otras 10–13 organizaciones (no es problema global).
- 17 días de cron con `partial` (479 correos encontrados, **0 procesados**) y bloques de 503 desde Supabase Edge Runtime alrededor del 24–28 abril. **No hay `IMAP_AUTH_FAILED`** — la credencial Hostinger funciona.
- El job se atasca porque `hostinger-fetch-invoices` descarga ~479 correos pero el procesamiento queda fuera de su ventana de 18 s. El dispatcher de `auto-sync-invoices` solo encadena hasta `maxIterations=8`, y cada chunk vuelve a re-descargar todo (no avanza el cursor).
- `check-sync-health` reporta "Gmail desconectado" para Terranoa, que **no usa Gmail**. La lógica solo mira `gmail_connected` y `quickbooks_connected`.
- Abril en `processed_documents`: 5 facturas (4 publicadas a QBO, 1 en review). Mayo: **0 facturas**.

## Causa raíz

1. **Gap de procesamiento**: el chunking actual saca correos en grupos pero solo procesa los primeros que caben en 18 s; el `next_skip_count` avanza por cantidad descargada, no por cantidad procesada. En Terranoa, con un buzón pesado, el dispatcher se quedó dando vueltas sin nunca avanzar antes del 28-abr.
2. **El sync de Terranoa se detuvo** después del 28-abr probablemente por una falla de dispatch silenciosa (sync_log no se insertó). Necesitamos trazas y un mecanismo de "kick" manual confiable.
3. **Alertas miopes**: `check-sync-health` asume Gmail/QBO como únicos canales válidos.

## Cambios

### A) Recuperación inmediata (Terranoa y similares)

1. Botón nuevo en `Dashboard.tsx` → **"Recuperar facturas pendientes (Terranoa)"** que invoca `auto-sync-invoices` con `organization_id` y `trigger: "manual_recovery"`. Reutiliza el patrón de `SyncEmailNowButton`. Visible solo para admins de la org afectada.
2. Edge function nueva `recover-org-backlog` que:
   - Recibe `{ organization_id, max_chunks?: number }`.
   - Llama a `hostinger-fetch-invoices` (o el provider correspondiente) en bucle hasta `max_chunks` (default 30) o hasta `partial=false`.
   - Avanza `skip_count` por **mensajes realmente procesados** (no por descargados).
   - Persiste un `sync_log` por chunk con `trigger_type='manual_recovery'`.
   - Retorna resumen `{ chunks_run, total_processed, total_skipped, last_error }`.
3. Al finalizar, dispara `publish-to-quickbooks` para limpiar pendientes.

### B) Fix sistémico del timeout en `hostinger-fetch-invoices` y `bluehost-fetch-invoices`

1. Cambiar la semántica de `next_skip_count`:
   - Antes: `skip_count + processedCount` (descargados).
   - Después: `skip_count + emails_consumed_in_loop` donde `emails_consumed_in_loop` es el índice del último correo cuyo XML se procesó O cuyo XML se decidió descartar (no inválidos pendientes).
2. Dentro del loop de procesamiento (línea 599), guardar `lastProcessedIndex = i` cada vez que terminamos un correo (no solo los exitosos). Si `stoppedEarly`, devolver `next_skip_count = currentSkip + lastProcessedIndex + 1`.
3. Reducir `MAX_PROCESSING_TIME_MS` de 18 s a **15 s** y reducir el batch IMAP de 100 a **40** correos por chunk para que siempre quepan.
4. En `auto-sync-invoices`, subir `maxIterations` de 8 a **15** y agregar guardia de tiempo total (max 90 s acumulados) para no exceder el wall-clock del runtime.
5. Persistir el cursor entre invocaciones del cron en `system_settings` con clave `hostinger_resume_skip_${org_id}` para no perder progreso si el chunk se aborta.

### C) Alertas correctas por servicio en `check-sync-health`

1. Ampliar `Organization` interface para incluir `outlook_connected`, `hostinger_connected`, `bluehost_connected`, `hostinger_email`, `outlook_email`, `bluehost_email`.
2. Reemplazar `checkConnections(org)` por una función que:
   - Detecta el provider activo (gmail/outlook/hostinger/bluehost).
   - Si **ninguno** está conectado → alerta crítica "Sin canal de correo".
   - Si el provider activo es Hostinger/Bluehost → reporta "Hostinger desconectado" / "Bluehost desconectado" cuando corresponda, **no** "Gmail desconectado".
3. La alerta "Sin sincronizaciones en 24+ horas" sigue válida — agregarle el `provider` detectado al `data` para diagnóstico.
4. Marcar como `acknowledged` automáticamente las alertas históricas mal etiquetadas (script idempotente, opcional).

## Detalle técnico

### Archivos modificados
- `supabase/functions/hostinger-fetch-invoices/index.ts` — cursor por procesados, batch=40, timeout=15s.
- `supabase/functions/bluehost-fetch-invoices/index.ts` — mismos cambios.
- `supabase/functions/auto-sync-invoices/index.ts` — `maxIterations=15`, guardia 90s, persistencia de cursor.
- `supabase/functions/check-sync-health/index.ts` — detección de provider, alertas correctas.
- `src/pages/Dashboard.tsx` — botón "Recuperar facturas pendientes" (admins).
- `src/components/dashboard/RecoverBacklogButton.tsx` — nuevo, similar a `SyncEmailNowButton`.

### Archivos nuevos
- `supabase/functions/recover-org-backlog/index.ts` — orquestador de recuperación, JWT verificado, RLS por `is_organization_member`.

### Sin cambios de schema
- No requiere migración; `system_settings` ya existe y permite la nueva clave por org.

### Validación
- Probar localmente con `curl_edge_functions` invocando `recover-org-backlog` para Terranoa.
- Confirmar que aparezcan filas `processed_documents` con `created_at >= 2026-05-15` para org `a247170a-...`.
- Confirmar que `alert_history` deja de generar "Gmail desconectado" en el siguiente `check-sync-health` (cada hora).

### Fuera de alcance
- No tocamos las credenciales de Hostinger (no son el problema).
- No reescribimos el publisher a QBO (funciona, solo no tiene insumos).
- No cambiamos el cron schedule (sigue cada 30 min).
