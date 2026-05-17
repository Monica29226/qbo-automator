## Plan: Outlook OAuth robusto + IMAP fallback + fix Dashboard

Implementación en 4 partes que se entregan juntas en este mensaje.

### PARTE A — Endurecer OAuth de Outlook

**`supabase/functions/outlook-oauth-init/index.ts`**
- Endpoint: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize` (ya está correcto).
- Scopes: `offline_access https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read` (URLs absolutas para forzar refresh tokens).
- `prompt=select_account consent` (en lugar de solo `select_account`).
- `response_mode=query`, `response_type=code`.
- `state`: ya recibe `state` del cliente; mantener (el cliente codifica org_id + user_id).

**`supabase/functions/outlook-oauth-callback/index.ts`**
- Tras intercambiar code → tokens, hacer `GET https://graph.microsoft.com/v1.0/me`.
- Si 200: guardar tokens en `integration_accounts` con `last_test_success_at = now()` dentro de `credentials`, marcar `outlook_connected = true` y `outlook_email`.
- Si !=200: NO marcar conectado, redirigir con `?error=token_test_failed&detail=...`.
- Mapear `?error=` de Microsoft: detectar códigos `AADSTS50020 / 65001 / 50105 / 500113 / 70008` y otros, redirigir a `/integrations?outlook_error=<code>&message=<texto>`.

**`src/pages/Integrations.tsx`** (banner de errores)
- Leer query params `outlook_error` y mostrar Alert con mensaje claro + 2 botones: "Reintentar OAuth" y "Probar IMAP" (abre modal IMAP).

### PARTE B — IMAP fallback para Microsoft 365

**Nueva edge function `supabase/functions/outlook-imap-connect/index.ts`**
- Recibe `{ organization_id, email, app_password }`.
- Hace LOGIN IMAP a `outlook.office365.com:993` TLS (mismo patrón que `bluehost-connect`).
- Si OK: upsert en `integration_accounts` con `service_type='outlook_imap'`, `credentials={ host, port:993, tls:true, username, password, last_test_success_at }`.
- Setear `organizations.outlook_connected = true`, `outlook_email = email`.

**Nueva edge function `supabase/functions/outlook-imap-fetch-invoices/index.ts`**
- Clon ligero de `hostinger-fetch-invoices` filtrando `service_type='outlook_imap'`, host por defecto `outlook.office365.com`.

**`supabase/config.toml`**: registrar ambas con `verify_jwt = true` (connect) y `true` (fetch).

**UI — `src/components/OutlookImapConnectDialog.tsx`** (nuevo)
- Modal con guía paso a paso para generar app password en Microsoft 365 + link.
- Inputs: email + app password + botón "Conectar y probar".
- Llama `outlook-imap-connect`.

**`src/pages/Integrations.tsx`**
- En tarjeta de Outlook agregar botón secundario "⚙️ Conectar con IMAP (avanzado)" que abre el modal.
- Reconocer `outlook_imap` como integración válida en la lista.

### PARTE C — `validate-org-setup` salud de correo

**`supabase/functions/validate-org-setup/index.ts`**
- Cambiar detección de email: consultar `integration_accounts` con `service_type IN ('gmail','outlook','outlook_imap','bluehost','hostinger')` y `is_active=true` (no depender solo de flags en `organizations`).
- `checks.email = true` por presencia (25 pts).
- Nuevo sub-check `emailFresh` (warning si última `last_test_success_at > 7 días`), sin restar puntos.
- Devolver `email_accounts: [{ service_type, account_email, last_test_success_at }]` para UI.

### PARTE D — Fix dashboard (StabilityScorePanel)

**`src/components/dashboard/StabilityScorePanel.tsx`**
- QBO conectado: consultar `integration_accounts` con `service_type='quickbooks' AND is_active=true` (no flag en `organizations`).
- Email conectado: cualquier `integration_accounts` activo en los 5 tipos.
- "Correo fresco" = sub-indicador informativo, NO penaliza score.
- Recalcular pesos: 30 QBO + 30 email + 20 sin errores + 20 IVA = 100.

### Updates auxiliares
- **`SyncEmailNowButton.tsx`**: añadir `outlook_imap → 'outlook-imap-fetch-invoices'` al `FN_MAP`.
- **`check-system-health` y `check-sync-health`**: incluir `'outlook_imap'` en arrays de tipos de email reconocidos.
- **`auto-sync-invoices`**: añadir dispatcher para `outlook_imap`.
- **`get_active_email_services` (DB function)**: ya incluye los 4 existentes — extender vía migración para incluir `outlook_imap`.

### Migración SQL
- Actualizar función `get_active_email_services` para añadir `'outlook_imap'` al array.
- (No requiere nueva tabla; `integration_accounts.credentials` es JSONB y absorbe `last_test_success_at`.)

### Notas y limitaciones
- Microsoft deshabilitó IMAP/app-passwords por defecto en muchos tenants empresariales desde sept-2024 (Basic Auth deprecation). La UI lo advierte; si el LOGIN falla con `LOGIN failed`, mostramos guía para que el admin habilite SMTP/IMAP AUTH en Exchange Admin Center.
- No tocaré `src/integrations/supabase/client.ts` ni `types.ts` (auto-gen).
- El reporte final con conteos lo correré con `read_query` tras aplicar la migración.

### Verificación post-cambio
1. Deploy de las 4 edge functions nuevas/editadas.
2. `read_query` por proveedor de correo + score de DENTORORI y Cafe Luna.
3. Validar build limpio.
