## Objetivo

Reemplazar el diagnóstico específico de Terranoa por un **paquete de diagnóstico global** que cubra **todas las organizaciones activas** del sistema, para pegárselo a Claude Code y que pueda detectar errores transversales (no solo de una empresa).

## Archivos a generar

1. `/mnt/documents/qbo_diagnostic_global.json` — snapshot completo del sistema (sin tokens ni secretos).
2. `/mnt/documents/qbo_diagnostic_global.py` — script standalone re-ejecutable contra cualquier ambiente.

Mantengo los archivos de Terranoa como están (no los borro) por si los necesitas de referencia.

## Contenido del JSON global

### 1. Metadatos del sistema
- Fecha de generación, versión de schema, conteo total de orgs activas/inactivas.

### 2. Resumen por organización (una fila por org)
Para **cada** organización activa:
- `id`, `name`, `tax_id`, `qbo_realm_id`
- Flags de conexión: gmail / outlook / hostinger / bluehost / quickbooks / sharepoint
- `default_account_ref`
- Conteos de `processed_documents` por status (pending, processed, review, error, currency_mismatch, published)
- Última fecha de factura recibida / publicada
- Conteo de `vendor_defaults` y cuántos apuntan a cuentas de activo (1xx) vs gasto (6xx)
- Estado del token QBO (expires_at, sin exponer access/refresh tokens)
- Última corrida de `sync_logs` (status, error_code)

### 3. Diagnóstico agregado (cross-org)
- **Orgs sin QBO conectado** pero con facturas pendientes.
- **Tokens QBO expirados o por expirar** (<24h).
- **Orgs con backlog > X horas** (procesadas sin publicar).
- **Errores recurrentes** agrupados por `error_message` con conteo y orgs afectadas (p.ej. "TaxCode 13% no existe" aparece en N orgs).
- **Vendors mapeados a cuentas de activo** — lista global con org + vendor + cuenta.
- **Tarifas IVA bloqueadas** detectadas en errores de QBO (13%, 4%, etc.) con conteo por org.
- **Inconsistencias** entre `organizations.{provider}_connected` y `integration_accounts.is_active`.
- **Orgs sin facturas en los últimos 7 días** con correo activo (posible backlog de correo).
- **Settings divergentes** entre orgs (p.ej. quién tiene `dry_run=true`).

### 4. Configuración global
- `system_settings` por org agrupados por key (para detectar valores raros).
- `bank_import_configs` activos.
- `sharepoint_admin_account` (solo metadatos: email, drive_id, is_active).
- Conteo de `alert_history` no resueltas por org y por código.

### 5. Errores actuales detallados (top 50 globales)
De `processed_documents` con status in ('error','review','currency_mismatch'):
- org_name, supplier_name, doc_number, total, currency, issue_date, default_account_ref, error_message, qbo_entity_id.

### 6. Tracking QBO en limbo
Últimos 50 `qbo_publish_tracking` con status != 'published' agrupados por org.

### 7. Logs de sincronización recientes
Últimos 50 `sync_logs` con error (todas las orgs), incluyendo error_code y error_detail.

## Script Python (`qbo_diagnostic_global.py`)

- Standalone, sin dependencias externas (usa `urllib` como el script de Terranoa).
- Recibe `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` por env vars.
- **No requiere ORG_ID** — recorre todas las orgs activas automáticamente.
- Replica todas las consultas y genera el JSON idéntico al snapshot.
- Sanitiza: nunca incluye `access_token`, `refresh_token`, `client_secret`, `credentials.password`, etc. Solo metadatos (expires_at, account_email, is_active).

## Pasos de implementación

1. Crear el script `/mnt/documents/qbo_diagnostic_global.py`.
2. Ejecutar todas las consultas vía `supabase--read_query` y armar el JSON sanitizado.
3. Guardar `/mnt/documents/qbo_diagnostic_global.json`.
4. Adjuntar ambos al chat con `<presentation-artifact>`.

## No modifica nada

Solo lectura. No cambia settings, no toca QBO, no edita facturas, no toca tokens.

## Hallazgos que el JSON dejará explícitos (esperados)

- Patrones de error compartidos entre orgs (TaxCodes faltantes, vendors mapeados a activo, tokens expirando).
- Orgs huérfanas o mal configuradas (correo conectado pero sin facturas, QBO desconectado con backlog).
- Settings inconsistentes (`dry_run=true` en algunas, IVA mode divergente).
