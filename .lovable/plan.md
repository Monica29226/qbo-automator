# Cambios al correo de invitación

## Problema detectado

1. **Nombre del producto**: los correos usan "InvoiceFlow", debe ser **"ACL Invoice"**.
2. **Link de acceso**: el botón "Iniciar Sesión" sí existe en el HTML, pero la URL se construye con `req.headers.get("origin")`. Cuando la función es invocada desde el frontend mediante `supabase.functions.invoke`, el header `origin` apunta al dominio desde el que se llamó (puede ser preview de Lovable) o queda en blanco y cae al fallback `http://localhost:5173`. Resultado: el correo llega con un botón que apunta a una URL no usable o el cliente de correo lo oculta por seguridad.

## Solución

### 1. Reemplazar marca "InvoiceFlow" → "ACL Invoice"
Archivos a actualizar (solo strings visibles al usuario, sin tocar lógica):
- `supabase/functions/create-user/index.ts` (asunto, encabezado HTML, remitente)
- `supabase/functions/send-invitation/index.ts` (plantilla HTML, asunto, remitente)
- `supabase/functions/send-bulk-welcome/index.ts` (plantilla HTML, asunto, remitente)
- `supabase/functions/batch-import-finalize/index.ts` (remitente)
- `supabase/functions/check-sync-health/index.ts` (remitente de alertas y firma)
- `supabase/functions/create-organization/index.ts` (default `email_sender_address`)

Remitente unificado: `"ACL Invoice <noreply@aureoncr.com>"`.

### 2. URL de acceso confiable
- Hardcodear el dominio de producción como base: `https://aclcostarica.com` (custom domain del proyecto).
- Usar `req.headers.get("origin")` solo si empieza con `https://` y no es `localhost`; en caso contrario, usar el dominio de producción.
- `loginUrl = ${baseUrl}/auth`.
- Aplicar en `create-user`, `send-invitation`, `send-bulk-welcome`.

### 3. Mejora de visibilidad del link en el correo
En `create-user` (y replicar el patrón en `send-invitation` / `send-bulk-welcome`):
- Mantener el botón "Iniciar Sesión".
- Añadir debajo un texto en plano: `Si el botón no funciona, copia este enlace: <a>https://aclcostarica.com/auth</a>` — así el usuario siempre ve y puede usar el link aunque el cliente de correo bloquee el botón.

## Fuera de alcance
- No se modifica la lógica de creación de usuario, RLS, ni el flujo de cambio de contraseña.
- No se forza cambio de contraseña en primer login (queda como recomendación).

¿Procedo con la implementación?
