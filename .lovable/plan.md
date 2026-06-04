## Correo de bienvenida rediseñado con marca ACL

### 1. URL fija a `https://facturas.aclcostarica.com/auth`
Reemplazar la lógica de `origin`/`PROD_URL` por URL fija en `supabase/functions/create-user/index.ts`.

### 2. Logo en bucket público
Subir `src/assets/acl-logo-new.png` → `email-assets/acl-logo.png` (URL pública embebible).

### 3. Plantilla HTML rediseñada
Reemplazar el HTML actual del correo con un diseño profesional optimizado para clientes de email (tablas anidadas, max-width 600px, mobile-friendly):

- **Header** con fondo primary `#26314D` y logo ACL centrado
- **Saludo personalizado** con nombre del usuario y nombre de la empresa en negrita primary
- **Tarjeta de credenciales** con borde lateral primary, fondo crema `#f8f6f0`, correo y contraseña en estilo monospace
- **Banner amarillo de seguridad**: "Cambia tu contraseña al ingresar"
- **CTA grande** primary "Ingresar a ACL Facturas →" enlazando a `https://facturas.aclcostarica.com/auth`
- **Fallback de enlace** debajo del botón
- **Footer** con marca ACL Costa Rica, año dinámico y aviso legal
- **Asunto:** `Bienvenido a ACL Facturas — Tus credenciales de acceso`
- **Remitente:** `ACL Costa Rica <noreply@aureoncr.com>` (dominio actualmente verificado en Resend)

### Paleta usada (de `src/index.css`)
- Primary `hsl(235 42% 26%)` = `#26314D`
- Primary-foreground `hsl(44 31% 91%)` = `#EDE6D3`
- Crema de fondo: `#f8f6f0`

### Archivos
- `supabase/functions/create-user/index.ts` — URL + plantilla HTML
- Subida de logo al bucket `email-assets`

### Fuera de alcance
- Cambio de remitente a `@aclcostarica.com` (requiere verificar dominio en Resend, paso aparte).
- Configuración de Lovable Emails con dominio propio (paso aparte).
- Cambios de feedback en `UsersManagement.tsx` (paso aparte).
