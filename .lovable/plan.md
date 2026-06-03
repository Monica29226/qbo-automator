
# Plan — Opción A: cada cliente conecta su propio Google Drive

Cada organización (Agrícola Llorona, etc.) hará su propio OAuth y las facturas se guardan en **su** Google Drive, en `Facturas FacturaFlow / AÑO / MES /`. El código ya está construido para este modelo — lo único que falta es **destrabar el OAuth en Google Cloud Console** para que no esté limitado a Test Users.

---

## Alcance

### 1. Configuración en Google Cloud Console (sin código)
Estos pasos los hacés vos una vez en tu cuenta de Google Cloud (proyecto del Client ID `132562544528-mdkq1fdp5o01f26d4emq69f1a51sjkb3.apps.googleusercontent.com`):

**a) Authorized redirect URI**
En *APIs & Services → Credentials → tu OAuth Client ID*, agregar exactamente:
```
https://lqirqvvkjpunhtsvebot.supabase.co/functions/v1/google-drive-oauth-callback
```

**b) OAuth Consent Screen → Publicar en "In production"**
- *APIs & Services → OAuth consent screen → Publish app*
- Como el único scope usado es `https://www.googleapis.com/auth/drive.file` (scope **no sensible** — solo accede a archivos creados por la app, no a todo el Drive del cliente), **NO requiere verificación de Google**. Es un click y queda abierto.
- Resultado: cualquier email puede conectar, ya no se necesita la lista de Test Users.

**c) Google Drive API habilitada**
*APIs & Services → Library → Google Drive API → Enable* (en el mismo proyecto).

### 2. UX en la app (sin cambios funcionales mayores, solo claridad)
El flujo actual en `/integrations` ya funciona:
- Botón "Conectar Google Drive" por organización
- Abre popup con OAuth de Google
- Callback guarda credenciales en `integration_accounts` (scoped por `organization_id`)
- Crea carpeta raíz `Facturas FacturaFlow` en el Drive del cliente
- Estructura: `Facturas FacturaFlow / 2026 / Enero / Proveedor - FE-123 - ₡125,000.pdf`

Mejoras menores de UX que conviene aplicar para clientes no técnicos:
- Mensaje claro en el popup de Google: "Esta app pedirá acceso solo a las facturas que ella misma cree en tu Drive" (esto lo controla la consent screen, ya queda implícito con `drive.file`)
- Texto en `/integrations` aclarando que cada usuario debe conectar **el Gmail/Google que sea dueño del Drive de la empresa**, no su Gmail personal.

### 3. Aislamiento por cliente (ya está, solo verifico)
- `integration_accounts` tiene `organization_id` + RLS → cada org solo ve sus credenciales
- `organizations.google_drive_folder_id` guarda la carpeta raíz por org
- `upload-to-google-drive` carga el access_token de la org correcta antes de subir
- Refresh token automático cuando expira

---

## Lo que NO cambia
- Código de edge functions (`google-drive-oauth-init`, `google-drive-oauth-callback`, `upload-to-google-drive`, `batch-upload-to-drive`) — ya está correcto.
- Schema de DB — ya tiene los campos necesarios.
- Scope `drive.file` se mantiene (mínimo privilegio, no requiere verificación de Google).

---

## Pasos para vos (orden)

1. **En Google Cloud Console** (5 min): agregar redirect URI + publicar consent screen + habilitar Drive API.
2. **Probar con Agrícola Llorona**: ir a `/integrations` con esa org activa → "Conectar Google Drive" → completar OAuth con el Gmail dueño del Drive de Agrícola.
3. **Verificar**: confirmar que aparece la carpeta `Facturas FacturaFlow` en ese Drive y que al publicar una factura, el PDF+XML aparecen en `2026/Enero/`.
4. Si algo falla, reviso logs de `google-drive-oauth-callback` para diagnosticar.

---

## Detalles técnicos

- **Scope usado**: `https://www.googleapis.com/auth/drive.file` — la app solo ve/modifica archivos que ella misma creó. No puede leer el resto del Drive del cliente. Por eso no requiere verificación de Google.
- **Tokens**: `access_token` (1h) + `refresh_token` guardados encriptados en `integration_accounts.credentials` (JSONB). La función `refreshGoogleDriveToken` los renueva automáticamente cuando expiran.
- **Aislamiento**: la query en `upload-to-google-drive` filtra por `organization_id` antes de cargar credenciales, garantizando que org A no pueda escribir en el Drive de org B.
- **Carpeta raíz por org**: `organizations.google_drive_folder_id` — se crea una vez al conectar y se reutiliza.

---

## Riesgos / consideraciones

- Si un cliente tiene varios usuarios y cada uno conecta un Drive distinto, **el último gana** (upsert por `organization_id + service_type`). Recomendación: solo el owner/admin de la org debería conectar Drive. Esto ya está implícitamente protegido por RLS, pero conviene mencionarlo en la UI.
- El branding del consent screen muestra el nombre de tu app de Google Cloud. Vale la pena asegurarse de que diga "FacturaFlow" o "ACL" para que el cliente confíe.

