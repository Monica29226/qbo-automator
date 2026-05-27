
# Arreglar Alertas del Sistema

## Diagnóstico

1. **Bug de render**: `SystemAlertsPanel.tsx` lee `issues_data` como objeto, pero la BD lo guarda como **array** `[{title, description, action_link, ...}]`. Por eso todas las tarjetas muestran solo "Alerta" sin contenido.
2. **Acumulación**: Los crons (`check-system-health`, `check-sync-health`, `refresh-integration-tokens`, etc.) insertan una fila nueva cada hora sin verificar si ya existe la misma alerta sin resolver y sin auto-resolver cuando la condición desaparece. Resultado: **2,179 alertas activas** (1,374 críticas + 805 warnings) repetidas.
3. **Valor real**: Los contenidos sí son útiles (token QBO expirando, sync atrasado, alta tasa de fallos, divisa incompatible, facturas atascadas en review).

## Cambios

### 1. Arreglar render — `src/components/dashboard/SystemAlertsPanel.tsx`

- Normalizar `issues_data`: si viene como array, expandir cada item como sub-alerta dentro de la misma fila (mostrar título, descripción, `action_link` y `actionRequired`). Si viene como objeto, mantener comportamiento actual.
- Agrupar visualmente por `alert_type` y deduplicar por `code`/`title` en cliente (solo mostrar la más reciente de cada tipo).
- Colapsar a sección compacta cuando hay >5 alertas: chip con conteo por severidad + botón "Ver detalle" para expandir.

### 2. Migración SQL — auto-resolver viejas + clave para dedup

```sql
-- Resolver todas las alertas existentes para empezar limpio
UPDATE public.alert_history
SET resolved = true,
    resolved_at = now()
WHERE resolved = false;

-- Índice para acelerar dedup por (org, código de alerta) sin resolver
CREATE INDEX IF NOT EXISTS idx_alert_history_org_unresolved
  ON public.alert_history (organization_id, alert_type, resolved)
  WHERE resolved = false;
```

### 3. Dedup + auto-resolución en edge functions

En `check-system-health/index.ts` y `check-sync-health/index.ts`:

- Antes de insertar, hacer `SELECT id FROM alert_history WHERE organization_id=$1 AND resolved=false AND issues_data::text ILIKE '%<code/title>%'`. Si existe, hacer `UPDATE` (refrescar `sent_at` y `issues_data`) en lugar de `INSERT` nuevo.
- Al final del check, para cada `code` que **ya no aplica** (ej. token renovado, sync al día, sin fallos en 24h), ejecutar `UPDATE alert_history SET resolved=true, resolved_at=now() WHERE organization_id=$1 AND resolved=false AND issues_data::text ILIKE '%<code>%'`.

Códigos a auto-resolver:
- `qbo_token_expiring` → cuando token vigente >2h
- `sync_delayed` → cuando última sync <6h
- `stuck_review` → cuando count facturas en review >3 días = 0
- `high_failure_rate` → cuando tasa fallos 24h <20%
- `currency_mismatch` → cuando count facturas con esta condición = 0

### 4. Memory

Actualizar `mem://features/system-alerts-dedup-and-auto-resolve` con la regla de dedup + auto-resolución por código.

## Archivos modificados

- `src/components/dashboard/SystemAlertsPanel.tsx` (render arreglado, agrupación, colapso)
- `supabase/functions/check-system-health/index.ts` (upsert + auto-resolve)
- `supabase/functions/check-sync-health/index.ts` (upsert + auto-resolve)
- Nueva migración SQL (reset + índice)
- `mem://features/system-alerts-dedup-and-auto-resolve` (nuevo)
- `mem://index.md` (referencia)

## No se toca

- Schema de `alert_history` (solo índice nuevo)
- RLS policies
- Lógica de publicación QBO ni cron schedules
