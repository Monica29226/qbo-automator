# Sistema de Alertas Proactivas

## Resumen
Crear edge function `check-system-health` ejecutada por cron cada hora que evalúe 7 indicadores por organización y registre alertas en `alert_history`. Agregar UI de alertas en el Dashboard con acciones de resolución.

## Cambios

### 1. Migración DB
- Agregar columna `resolved boolean default false` a `alert_history`
- Agregar columna `resolved_at timestamptz` y `resolved_by uuid` (consistente con campos `acknowledged_*` existentes pero específica para "resolved")
- Índice en `(organization_id, resolved, sent_at desc)` para queries rápidas del dashboard

### 2. Nueva edge function `check-system-health`
Archivo: `supabase/functions/check-system-health/index.ts`

Para cada org activa, ejecuta los 7 chequeos en paralelo:

| # | Indicador | Tipo | Condición |
|---|-----------|------|-----------|
| 1 | Procesadas sin publicar (qbo_entity_id null, >24h) | warning | count > 0 |
| 2 | En review >48h | warning | count > 0 |
| 3 | Errores ≥5 en 7 días | critical | count ≥ 5 |
| 4 | Sin facturas en 7+ días (con histórico ≥10) | warning | last_created_at > 7d |
| 5 | `organizations.{provider}_connected=true` pero falta `integration_accounts.is_active=true` | critical | inconsistencia por proveedor |
| 6 | Token QBO expira en <2h | warning | expires_at < now+2h |
| 7 | 0 facturas en 24h pero correo activo >24h | critical | combinación |

**Anti-duplicación**: antes de insertar, query `alert_history` con `alert_type` (usaremos un sub-tipo en `issues_data.code`) creado en las últimas 4h para esa org y mismo `code`. Si existe y `resolved=false`, skip.

**Insert por alerta** (no agrupado): un row por alerta para que el botón "resolver" funcione individualmente. `alert_type` = severidad (critical/warning/info). `issues_data` incluye `{code, title, description, action, action_link, count, metadata}`.

### 3. Cron schedule
Usar `supabase--insert` con `cron.schedule` (pg_cron + pg_net) cada hora. Mantener `check-sync-health` existente intacto.

### 4. UI Dashboard
Nuevo componente `src/components/dashboard/SystemAlertsPanel.tsx`:
- Query `alert_history` filtrado por `organization_id` actual + `resolved=false`, orden `sent_at desc`
- Realtime subscription sobre alert_history
- Tarjeta por alerta: icono por severidad (AlertCircle rojo / AlertTriangle amarillo / Info verde), título, descripción, timestamp relativo, botón de acción contextual (link interno a `/integrations`, `/error-documents`, o invocar recover-org-backlog), botón "Marcar como resuelta"
- Estado vacío: "✅ Sistema saludable"
- "Marcar como resuelta": UPDATE `resolved=true, resolved_at=now(), resolved_by=auth.uid()`

Insertar el panel en `src/pages/Dashboard.tsx` justo arriba del `CronMonitor`.

### 5. RLS
Agregar policy UPDATE para members (resolver alertas), o reutilizar la existente "Members can acknowledge alerts" extendiéndola al campo resolved (ya cubre UPDATE con USING is_organization_member).

## Detalles técnicos

- Edge function con CORS, JWT no requerido (cron). Service role key para queries cross-org.
- Códigos de alerta estables: `processed_not_published`, `review_stuck`, `errors_accumulated`, `no_recent_invoices`, `mail_integration_inconsistent`, `qbo_token_expiring`, `mail_backlog_suspected`.
- `issues_data.action_link` apunta a rutas frontend (`/integrations`, `/error-documents`, `/dashboard?action=recover`).
- Anti-spam: ventana de 4h por `(organization_id, issues_data->>'code')` no resueltas.
- Frontend: usar `is_organization_member` implícito vía RLS para que cada org solo vea sus alertas.

## Fuera de alcance
- Envío de emails (ya cubierto por check-sync-health).
- Modificación de funciones de procesamiento existentes.
- Cambios a `check-sync-health`.
