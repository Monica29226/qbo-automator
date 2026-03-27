

# Plan: Gestión de Usuarios (Persona Física/Jurídica) + Corrección Outlook/Auto-Sync

## BLOQUE 1 — Gestión de Usuarios

### 1.1 Migración de BD — Agregar columnas a `profiles`
La tabla `profiles` ya existe con `id, email, full_name, avatar_url, created_at, updated_at`. Se agregarán las columnas directamente aquí (no hay necesidad de tabla nueva):

```sql
ALTER TABLE public.profiles
  ADD COLUMN tipo_persona text NOT NULL DEFAULT 'fisica',
  ADD COLUMN numero_cedula text,
  ADD COLUMN nombre_comercial text,
  ADD COLUMN nombre_representante text,
  ADD COLUMN cedula_representante text,
  ADD COLUMN telefono text,
  ADD COLUMN direccion text,
  ADD COLUMN activo boolean NOT NULL DEFAULT true;

-- Índice único para cédula por no-null
CREATE UNIQUE INDEX idx_profiles_numero_cedula ON public.profiles (numero_cedula) WHERE numero_cedula IS NOT NULL;
```

### 1.2 Formulario Crear Usuario — `UsersManagement.tsx`
Rediseñar el modal de creación:
- Agregar toggle "Persona Física" / "Persona Jurídica" al inicio
- **Persona Física**: Nombre Completo, Cédula (auto-format X-XXXX-XXXX), Email, Teléfono, Dirección, Contraseña, Rol, Empresas
- **Persona Jurídica**: Razón Social, Nombre Comercial, Cédula Jurídica (auto-format X-XXX-XXXXXX), Email, Teléfono, Dirección, Representante Legal, Cédula Representante, Contraseña, Rol, Empresas
- Validaciones: cédula física = 9 dígitos, auto-formateo con guiones, cédula jurídica inicia con 3
- Validar cédula no duplicada contra `profiles.numero_cedula` antes de enviar

### 1.3 Edge Function `create-user` 
Actualizar para recibir y guardar los nuevos campos:
- Recibir: `tipo_persona`, `numero_cedula`, `nombre_comercial`, `nombre_representante`, `cedula_representante`, `telefono`, `direccion`
- Después de crear el usuario en auth, actualizar `profiles` con los nuevos campos
- Para jurídicas, `full_name` = razón social

### 1.4 Tabla de usuarios en `UsersManagement.tsx`
Actualizar columnas: Nombre/Razón Social | Tipo (badge azul/morado) | Cédula | Correo | Rol | Estado (Activo/Inactivo) | Acciones (Editar, Activar/Desactivar, Eliminar)

### 1.5 Hook `useUserManagementData.ts`
Actualizar query de profiles para incluir los nuevos campos: `tipo_persona, numero_cedula, nombre_comercial, activo`

---

## BLOQUE 2 — Corrección Outlook / Auto-Sync

### 2.1 `outlook-fetch-invoices` — Ya tiene refresh logic
Revisando el código, la función **ya tiene** lógica de refresh token (líneas 57-118) y manejo de 401 con retry (líneas 194-201). Sin embargo hay gaps:
- Agregar manejo de 403 (permisos insuficientes) y 429 (rate limit con retry)
- Mejorar el error logging: guardar `error_detail` y `error_code` en sync_logs
- Cuando el token falla, retornar un `error_category: "token_expired"` para que auto-sync lo detecte

### 2.2 Migración — Agregar columnas a `sync_logs`
```sql
ALTER TABLE public.sync_logs
  ADD COLUMN error_detail text,
  ADD COLUMN error_code text;
```

### 2.3 `SystemStatusPanel.tsx` — Mostrar error_detail + error_message
- Fetch `error_message, error_detail, error_code` del último sync_log
- Si status es error, mostrar el detalle debajo del badge (ej: "Token expirado - reconectar Outlook")
- Si error_code = 'token_expired', mostrar botón "Reconectar Outlook" que inicia el OAuth flow

### 2.4 `Settings.tsx` — Auto-detectar proveedor de correo
- En `fetchSettings`, también leer `organizations.gmail_connected` y `organizations.outlook_connected`
- Si Outlook conectado → pre-seleccionar 'outlook'
- Si Gmail conectado → pre-seleccionar 'gmail'
- Guardar automáticamente la selección si difiere del valor actual

### 2.5 `auto-sync-invoices` — Mejorar error handling
- Cuando `outlook-fetch-invoices` retorna error con `error_category: "token_expired"`, registrar en sync_log con `error_code = 'token_expired'` y `error_detail` específico
- Continuar con otras orgs (ya lo hace via dispatcher pattern)

### 2.6 `outlook-fetch-invoices` — Agregar búsqueda en Junk/Spam
- Después de buscar en Inbox, buscar en wellKnownFolders: `JunkEmail`
- `https://graph.microsoft.com/v1.0/me/mailFolders/JunkEmail/messages?$filter=...`

---

## Archivos a crear/editar

| Archivo | Acción |
|---------|--------|
| `supabase/migrations/` | Nueva migración: columnas en profiles + sync_logs |
| `src/pages/UsersManagement.tsx` | Rediseñar formulario + tabla con nuevos campos |
| `src/hooks/useUserManagementData.ts` | Incluir nuevos campos de profiles |
| `supabase/functions/create-user/index.ts` | Recibir y guardar campos persona física/jurídica |
| `supabase/functions/outlook-fetch-invoices/index.ts` | Agregar manejo 403/429, búsqueda Junk, error categories |
| `supabase/functions/auto-sync-invoices/index.ts` | Mejorar error logging con error_code/error_detail |
| `src/components/settings/SystemStatusPanel.tsx` | Mostrar error_detail + botón reconectar Outlook |
| `src/pages/Settings.tsx` | Auto-detectar proveedor de correo conectado |

