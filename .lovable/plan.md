## Objetivo

Generar un paquete de diagnóstico (`/mnt/documents/qbo_diagnostic_terranoa.json` + `/mnt/documents/qbo_diagnostic_terranoa.py`) con toda la configuración relevante de la org **Centro Medico Terranoa** y los errores actuales, para que Claude Code pueda analizarlo offline.

## Qué incluirá el JSON exportado

1. **Organization**
   - id, name, tax_id, identification, qbo_realm_id, banderas de conexión (gmail/outlook/hostinger/bluehost/quickbooks), default_account_ref.

2. **Integraciones activas** (`integration_accounts`)
   - service_type, account_email, is_active, created_at, realm_id, expires_at del token (sin exponer access_token/refresh_token — solo metadatos).

3. **Settings** (`system_settings` de la org)
   - Todos los pares key/value (dry_run, mail_provider, currency_fallback, duplicate_window_days, tax_handling_mode si existe, etc.).

4. **Vendor defaults** (35 reglas)
   - vendor_name, default_account_ref, default_uses_tax. Marcar cuáles apuntan a cuentas de activo (rango 1xx) vs gasto (rango 6xx).

5. **Resumen de facturas** (`processed_documents`)
   - Conteo por status.
   - Totales por mes y por moneda.
   - Listado completo de **errores y review** con: id, supplier_name, doc_number, total, issue_date, default_account_ref, error_message, qbo_entity_id.

6. **Tracking QBO** (`qbo_publish_tracking`)
   - Últimos 20 registros con status != published para detectar limbo.

7. **Logs de sincronización** (`sync_logs`)
   - Últimos 10 corridos: status, error_detail, timestamps.

8. **Diagnóstico precomputado**
   - Lista de vendors mapeados a cuentas de activo (no aparecen en P&L).
   - Lista de tarifas IVA bloqueadas que QBO no tiene configuradas (13%, 4% — ya detectadas).
   - Vendors sin regla automática que están en review.

## Script Python (`qbo_diagnostic_terranoa.py`)

Será un script standalone que recibe:
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `ORG_ID` por env vars.
- Usa `requests` + PostgREST (sin dependencias raras).
- Re-ejecuta todas las consultas anteriores y vuelca un JSON idéntico.

Esto permite al usuario:
- Tomar el JSON ya generado y pegarlo en Claude Code.
- O ejecutar el script de nuevo cuando cambien los datos.

## Pasos de implementación

1. Crear `/mnt/documents/qbo_diagnostic_terranoa.py` con el script standalone.
2. Ejecutar las consultas SQL (vía supabase--read_query) y generar `/mnt/documents/qbo_diagnostic_terranoa.json` con todos los datos sanitizados (sin tokens).
3. Adjuntar ambos artefactos al chat con `<presentation-artifact>` para que el usuario los descargue.

## Hallazgos preliminares que el JSON dejará explícitos

- **4 errores son todos por TaxCode faltante en QBO** (tarifas 13% y 4%). Es problema de configuración en QuickBooks, no del sistema. Hay que crear los TaxCode/TaxRate correspondientes en QBO antes de reintentar.
- **3 facturas en review** son de proveedores sin regla (Electromecánica Artico CR SA, YANDOLIN DAYANA MORALES PEREZ ×2). Se resuelven asignándoles una cuenta default.
- **7 vendor_defaults apuntan a cuentas de activo** (142, 143, 149, 150, 152, 173, 132) — por eso el P&L se ve incompleto en feb/mar/abr.
- Token QBO expira hoy (auto-renew debería actuar; si no, queda registrado en el JSON).

## No modifica nada

Solo lee datos. No cambia settings, no toca QBO, no edita facturas.
