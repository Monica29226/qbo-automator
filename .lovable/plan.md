## Sprint de pulido final — Plan

Trabajo dividido en 6 partes. Ejecuto queries de inspección primero, luego migrations/inserts y código, y cierro con un reporte.

### Parte A — Backfill 6 empresas estables
1. Query a `processed_documents` + `vendor_defaults` para detectar la cuenta más usada por organización (solo las 6 estables).
2. `UPDATE organizations SET default_account_ref = <top>` cuando se pueda determinar.
3. `INSERT` en `system_settings` clave `default_uses_tax = 'true'` si no existe.
4. `INSERT ... ON CONFLICT` en `onboarding_progress` marcando `current_step=7`, `completed_at=NOW()`, `step_data={"backfilled":true}`. Requiere índice/único en `organization_id`; si no existe, crear con migration.

### Parte B — Limpieza alertas obsoletas
1. Migration: agregar índice `(organization_id, created_at)` en `alert_history` si ayuda; principal: `UPDATE alert_history SET resolved=true` con la condición del usuario (vía insert tool).
2. Editar `supabase/functions/check-system-health/index.ts`: tras insertar nueva alerta, marcar como `resolved=true` las del mismo código con `created_at < now()-24h` sin ocurrencia más reciente.

### Parte C — Archivar empresas fantasma
1. Query candidatas (sin integrations activos y sin processed_documents).
2. Listar nombres y `UPDATE organizations SET is_active=false` para esos IDs.

### Parte D — UI rápida
1. `src/pages/LegacyAccountMapping.tsx`: botón "Auto-mapear por similitud" (matching de nombre legacy code vs `accounts[].name`/number con `Levenshtein` simple/`includes`); por cada fila sin mapear, expandible mostrando facturas afectadas (doc_number, supplier_name, total).
2. Nueva página `src/pages/AdminCleanupQuickActions.tsx` con selector de empresa y 4 botones que invocan: `publish-to-quickbooks`, `retry-qbo-waiting`, update alertas, y un nuevo endpoint de backfill.
3. Dashboard: en `Dashboard.tsx`/`StabilityScorePanel`, mostrar CTA "Hay X facturas esperando mapeo" si `processed_documents.status='needs_account_mapping' > 0`. Enlace a `/legacy-account-mapping`.
4. Registrar nueva ruta en `src/App.tsx`.

### Parte E — Edge function `get-optimal-config`
- Input: `{ organization_id }`.
- Output JSON:
  - `top_vendor_defaults` (10 más usados con cuenta).
  - `tax_rates` configuradas en QBO vs faltantes (6 estándar CR: 0/1/2/4/8/13).
  - `top_accounts` (cuentas más usadas en `processed_documents`).
  - `suggested_default_account_ref`.
- JWT verify true + RLS membership check.

### Parte F — Edge function `replicate-org-config`
- Input: `{ source_org_id, target_org_id, confirm: true }`.
- Verifica que el caller es admin de ambas orgs.
- Copia:
  - `vendor_defaults` del source al target (skip si ya existe el vendor_name en target).
  - `legacy_account_mapping` (skip duplicados).
  - `system_settings` solo claves IVA (`default_uses_tax`, `tax_handling_mode`, etc.).
- NO copia integrations ni documentos.
- UI: en `Step6Rules.tsx` agregar botón "Replicar desde otra empresa" que muestra dialog con dropdown de orgs y llama la function.

### Migrations necesarias
- `onboarding_progress`: UNIQUE en `organization_id` (verificar primero, si ya existe skip).
- `supabase/config.toml`: registrar `get-optimal-config` y `replicate-org-config` con `verify_jwt = true`.

### Reporte final
Después de aplicar, ejecuto queries y reporto:
1. Empresas con `default_account_ref` poblado (de las 6).
2. Total alertas resueltas (cambio en COUNT).
3. Empresas archivadas (nombres).
4. Score nuevo de las 6 (invocando `validate-org-setup`).
5. Confirmación operativa.

### Notas
- Todo respeta aislamiento `organization_id`.
- Cero borrado destructivo; solo flags y backfill.
- Los nuevos endpoints requieren JWT y validan membership.
