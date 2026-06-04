# Arreglar conexión Gmail OAuth

## Causa raíz

`supabase/functions/gmail-oauth-callback/index.ts` envía el `postMessage` de éxito con `targetOrigin = SUPABASE_URL.origin` (dominio `*.supabase.co`). El `window.opener` es la app (`lovable.app` / `facturas.aclcostarica.com`), un origen distinto. El navegador descarta el mensaje silenciosamente, así que la UI nunca recibe `gmail-connected` y aparenta no conectarse — aunque los tokens **sí** se guardan en `integration_accounts`.

## Verificación previa

1. Confirmar en DB que las últimas conexiones de Gmail intentadas hoy quedaron guardadas (consulta a `integration_accounts` y `organizations.gmail_connected`). Si están guardadas, queda probado el diagnóstico.

## Cambios

### 1. `supabase/functions/gmail-oauth-callback/index.ts`
- Aceptar el origen del opener via el parámetro `state` (agregar `origin: window.location.origin` desde el cliente al construir el state).
- En el callback: parsear `stateData.origin`, validar contra una allowlist (`*.lovable.app`, `facturas.aclcostarica.com`, `localhost`), y usarlo como `targetOrigin` del `postMessage`.
- Fallback: si no viene origin válido, postear a `'*'` (peor caso, pero el mensaje sí llega) — preferible al silencio actual.

### 2. `src/pages/Integrations.tsx` — `handleGmailOAuth`
- Incluir `origin: window.location.origin` dentro del objeto `state` base64.

### 3. Replicar el mismo fix en los otros callbacks OAuth que usan el mismo patrón
Revisar y aplicar igual donde aplique:
- `supabase/functions/outlook-oauth-callback/index.ts`
- `supabase/functions/google-drive-oauth-callback/index.ts`
- `supabase/functions/onedrive-oauth-callback/index.ts`
- `supabase/functions/sharepoint-oauth-callback/index.ts`
- `supabase/functions/quickbooks-oauth-callback/`
Y sus correspondientes handlers en el frontend para mandar `origin` en el state.

## Validación

1. Click "Conectar con Gmail" desde `facturas.aclcostarica.com` y desde el preview.
2. Confirmar que aparece toast "Gmail conectado: <email>", el diálogo se cierra, y `fetchData()` refresca la lista.
3. Verificar logs del edge function: ya no aparece "No window.opener found" ni mensaje silencioso.
