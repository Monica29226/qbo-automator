# Estado real del sistema post-upgrade

## 1) Proyecto Supabase
- **Estado:** ACTIVE_HEALTHY (Lovable Cloud responde normal).
- **Plan:** Pro (upgrade aplicado).
- **No hay pausas recientes** detectadas en la API.

## 2) Cron jobs (todos `active = true`)

| Job | Schedule | Última corrida | Status |
|---|---|---|---|
| auto-renew-qbo-tokens-15min | */15 * * * * | 2026-05-18 20:15 | succeeded |
| auto-sync-invoices-every-30min | */30 * * * * | 2026-05-18 20:00 | succeeded |
| check-sync-health-hourly | 0 * * * * | 20:00 | succeeded |
| check-system-health-hourly | 0 * * * * | 20:00 | succeeded |
| retry-qbo-waiting-every-6h | 0 */6 * * * | 18:00 | succeeded |
| retry-sharepoint-uploads-hourly | 0 * * * * | 20:00 | succeeded |
| unstick-publishing-30min | */30 * * * * | 20:00 | succeeded |

Todos corrieron dentro del intervalo. Ninguno está atrasado >2h.

## 3) BUG CRÍTICO encontrado: los crons "succeeded" pero la función no procesa nada

Evidencia:
- `sync_logs`: última fila **2026-05-15 21:08** (hace ~3 días). 0 logs en últimas 2h.
- `processed_documents`: último documento **2026-05-15 20:19**. 0 docs nuevos en 24h ni 3d.
- `function_edge_logs` filtrado por `auto-sync-invoices`: **vacío**.
- `auto-renew-tokens` sí aparece corriendo cada 15min con éxito (porque autentica internamente vía SERVICE_ROLE secret).

**Causa raíz:** los crons creados (auto-sync-invoices-every-30min y unstick-publishing-30min) usan la **ANON key** como `Authorization: Bearer`. La función `auto-sync-invoices` exige service-role o JWT de usuario válido y devuelve 401 silenciosamente al ANON. `net.http_post` solo encola y devuelve `request_id`, por eso `job_run_details` aparece como `succeeded` — eso solo confirma que el POST se encoló, no que la función ejecutó.

Comando actual del cron (extracto):
```
headers := '{"Authorization": "Bearer eyJ...anon..."}'
```

## 4) Plan de corrección

### Paso 1 — Reescribir los 2 crons con SERVICE_ROLE
Reemplazar `auto-sync-invoices-every-30min` y `unstick-publishing-30min` con el mismo schedule pero usando `current_setting('app.service_role_key', true)` o, si no está disponible, hardcodear el `SUPABASE_SERVICE_ROLE_KEY` (mismo patrón que ya usan `auto-renew-qbo-tokens-15min` y los otros crons que sí funcionan — voy a verificar cuál mecanismo usan y replicarlo).

Verificar también el resto: `check-sync-health-hourly`, `check-system-health-hourly`, `retry-qbo-waiting-every-6h`, `retry-sharepoint-uploads-hourly`. Si alguno también usa ANON y su función requiere service-role, repararlo igual.

### Paso 2 — Disparo manual de prueba
Llamar a `auto-sync-invoices` con SERVICE_ROLE y `trigger: "manual"`. Esperar 60–90s y revisar:
- Nuevas filas en `sync_logs` (debería haber una por organización con email conectado).
- Nuevos `processed_documents`.
- Logs en `function_edge_logs` para `auto-sync-invoices` y para los `*-fetch-invoices` aguas abajo.

### Paso 3 — Verificación post-fix
A los 30 min, confirmar que el cron disparó automáticamente y generó logs y documentos. Reportar:
- # de orgs procesadas.
- # facturas nuevas.
- # errores nuevos (si hay) clasificados por categoría.

## Notas técnicas

- No tocar `auto-renew-qbo-tokens-15min` ni edge functions que ya funcionan.
- El fix es solo en la definición SQL del cron (usar `supabase--insert` con `SELECT cron.unschedule(...)` + nuevo `cron.schedule(...)` o equivalente). Cero cambios de código frontend.
- Una vez aprobado el plan paso a modo build para aplicar la corrección.
