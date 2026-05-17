# SharePoint Integration Plan

Conexión administrativa única (MONICA@calderon.cr) que sube automáticamente PDF + XML a SharePoint cuando una factura se publica en QBO. Estructura: `FacturaFlow / {Empresa} / {Año} / {Mes en español}`.

## Parte A — Base de datos y OAuth

**Migración 1** (`supabase--migration`):
- `sharepoint_admin_account` (singleton): admin_email, site_id, site_url, drive_id, root_folder_id, root_folder_path='FacturaFlow', credentials JSONB, is_active. RLS: solo admins (`has_role(auth.uid(),'admin')`).
- `processed_documents` ADD: sharepoint_pdf_id, sharepoint_xml_id, sharepoint_uploaded_at, sharepoint_status.
- `organizations` ADD: sharepoint_folder_override TEXT, sharepoint_enabled BOOLEAN DEFAULT true.

**Edge functions**:
- `sharepoint-oauth-init`: redirige a `login.microsoftonline.com/common/oauth2/v2.0/authorize` con scopes Sites.ReadWrite.All, Files.ReadWrite.All, offline_access. State firmado con adminMode=true.
- `sharepoint-oauth-callback`: intercambia code → tokens, llama `/me` para validar email, lista `/sites?search=*`. Si state trae `site_id` lo persiste; si no, retorna JSON con sitios para que UI elija. Crea/verifica carpeta `FacturaFlow` y guarda en `sharepoint_admin_account`.
- `sharepoint-select-site` (helper): recibe `site_id`, resuelve drive_id y root_folder_id, persiste.

**UI**: `/admin/sharepoint-setup` (`src/pages/AdminSharePointSetup.tsx`)
- Estado conectado/desconectado, botones Conectar / Probar / Desconectar.
- Selector de sitio (si se conectó pero no eligió).
- Editar root_folder_path.
- Solo accesible si `has_role admin`.

Reutiliza `MICROSOFT_CLIENT_ID` y `MICROSOFT_CLIENT_SECRET` ya existentes.

## Parte B — Upload core

**Helpers compartidos** dentro de cada edge function (Deno no permite imports cross-function fácilmente):
- `refreshSharePointToken(supabase)`: lee fila singleton, refresca si exp<now+60s, persiste.
- `ensureFolderPath(token, driveId, parentId, segments[])`: recursivo, busca por `$filter=name eq` y crea con `conflictBehavior=fail` (ignorando 409).
- `buildSafeFileName(supplier, amount, date, currency, ext)`: sanitiza, formato `{supplier}_{amount}_{YYYY-MM-DD}.{ext}`. CRC entero, USD con guión (`18-20`), trunca a 80.
- `monthEs(date)`: Enero…Diciembre.

**Edge function `upload-to-sharepoint`** (input: `{ document_id }`):
1. Carga doc + organization.
2. Skip si org.sharepoint_enabled=false o no hay sharepoint_admin_account activa.
3. Refresca token, construye path `[root, folder_override||org.name, año, mes_es]`.
4. Por cada uno de pdf_attachment_url / xml_attachment_url: descarga del bucket (Supabase storage path o URL), PUT `/drives/{driveId}/items/{folderId}:/{name}:/content?@microsoft.graph.conflictBehavior=replace`.
5. Persiste sharepoint_pdf_id, sharepoint_xml_id, sharepoint_uploaded_at=now, sharepoint_status='uploaded'. Si error → 'failed' + error_message.

## Parte C — Auto trigger + retry

**Modificar `publish-to-quickbooks`**: después de set `qbo_entity_id`, fire-and-forget `supabase.functions.invoke('upload-to-sharepoint', { body: { document_id } })` envuelto en try/catch silencioso.

**Edge function `retry-sharepoint-uploads`**: busca docs con qbo_entity_id NOT NULL, sharepoint_uploaded_at NULL, created_at > now()-7d, sharepoint_status != 'failed' OR retry_count<5. Procesa en serie.

**Cron** (vía `supabase--insert` con `cron.schedule`): cada hora invoca retry-sharepoint-uploads.

## Parte D — UI

- **Botón en vista de factura** (`src/components/invoices/InvoiceDetail*` o donde se muestre): "📁 Subir a SharePoint". Visible si admin account activa. Llama upload-to-sharepoint.
- **`/admin/sharepoint-bulk-upload`** (`src/pages/AdminSharePointBulkUpload.tsx`): filtros empresa+fechas, lista candidatos, "Subir todas" en lotes de 20 con progress.
- **Columna en lista de facturas**: icono ☁️ verde / ☁️❌ rojo / vacío. Editar componente existente de tabla de facturas.

## Parte E — Dashboard + alertas

- **5ta tarjeta KPI** en Dashboard: count subidas mes vs publicadas mes, con CTA si no conectado.
- **check-system-health**: si >10 docs publicadas con sharepoint_uploaded_at NULL >24h → alert warning code `sharepoint_pending_upload`.

## Parte F — Rutas

- Registrar `/admin/sharepoint-setup` y `/admin/sharepoint-bulk-upload` en `src/App.tsx` con guard de admin.

## Reglas críticas
- SharePoint NUNCA bloquea publish-to-quickbooks (siempre try/catch + log).
- conflictBehavior=replace para sobrescritura.
- Tokens refrescados automáticamente.
- Logs `[SharePoint] org=X doc=Y → /path, Files: PDF+XML, OK`.
- NO conexión automática — usuaria conecta manualmente al final.

## Despliegue
1. Migración DB.
2. Crear 4 edge functions + cron.
3. Crear UIs + rutas + integraciones de dashboard/lista.
4. Modificar publish-to-quickbooks y check-system-health.
5. Reportar a la usuaria que entre a `/admin/sharepoint-setup` para conectar MONICA@calderon.cr.

## Nota de alcance
Es un sprint grande (~10 archivos nuevos + 4 modificaciones + 1 migración + 1 cron). Procederé en este orden si apruebas: DB → upload core → OAuth → UI setup → triggers/cron → bulk/UI list/dashboard.