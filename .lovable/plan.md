
## Objetivo

Permitir que un administrador global pueda:
1. Crear un usuario y asignarlo a **una, varias o todas** las empresas de un solo paso, sin errores parciales.
2. Eliminar un usuario y que **no queden rastros** (perfil, membresías, rol, organización activa, invitaciones, sesión).
3. Mostrar el mismo rol en todas las empresas asignadas al usuario.

## Causas raíz detectadas

1. **Acceso a "todas las empresas" falla.** `create-user` valida que el llamante sea `owner/admin` de cada `organization_id`. El UI lo invoca una vez por empresa, así que si el admin global no es miembro de cada una, fallan todas menos las que administra. Las políticas RLS ya reconocen `has_role(auth.uid(),'admin')` como admin global, pero la edge function no.
2. **Rol ignorado.** `create-user` siempre inserta a la membresía como `member` y guarda el rol global con un mapeo arbitrario (`admin → admin`, todo lo demás → `user`).
3. **Organización fantasma "Mi Empresa".** El trigger `handle_new_user_organization` crea una organización + settings por cada signup, ensuciando la base cuando un admin crea usuarios.
4. **Eliminación parcial.** `delete-user` borra tablas manualmente antes del `auth.admin.deleteUser`. Si una FK falla o el borrado de auth corta a mitad, quedan huérfanos. Además no limpia `organization_invitations`, `password_reset_tokens`, `audit_log`, ni invalida sesiones.
5. **UI hace N llamadas seriales.** Una falla en medio deja al usuario asignado solo en algunas empresas con un toast confuso de "X de Y fallaron".

## Cambios

### 1. Backend — `create-user` (multi-empresa atómico)

- Aceptar `organization_ids: string[]` además del actual `organization_id` (compatibilidad).
- Permisos: aceptar al llamante si **es admin global** (`has_role(auth.uid(),'admin')`) **o** admin de cada organización solicitada. Si es admin por empresa, filtrar la lista a las que sí administra y devolver `skipped[]`.
- Crear/actualizar el usuario una sola vez, luego hacer `upsert` masivo en `organization_members` con el rol elegido (`owner|admin|member|viewer`).
- Guardar `user_roles` solo cuando `role === 'admin'` (rol global); en el resto, el rol vive en `organization_members`.
- Respuesta unificada: `{ userId, added: [...], skipped: [...], alreadyMember: [...] }`.

### 2. Backend — `delete-user` (limpieza confiable)

- Orden invertido: primero `auth.admin.deleteUser` y, si tiene éxito, dejar que la limpieza la haga la base por `ON DELETE CASCADE`.
- Migración para añadir/forzar `ON DELETE CASCADE` desde `auth.users` hacia: `profiles`, `organization_members`, `user_roles`, `user_active_organization`, `password_reset_tokens`, y `invited_by` en `organization_invitations` (este último `ON DELETE SET NULL`).
- Borrar invitaciones por email del usuario (no quedan colgadas).
- Devolver `{ success, deleted: { auth, profile, memberships, roles, invitations } }` con conteos para visibilidad.

### 3. Backend — Trigger "Mi Empresa"

- Eliminar el trigger que dispara `handle_new_user_organization` (mantener la función por compatibilidad pero sin trigger activo). `handle_new_user` (perfil + rol desde `allowed_emails`) se conserva.

### 4. Frontend — `UsersManagement.tsx`

- Reemplazar el `for` que invoca `create-user` por **una sola llamada** con `organization_ids: selectedOrganizations` y `role`.
- Mostrar resultado consolidado: "Creado y asignado a N empresas" + lista de las que se omitieron (con motivo).
- Mostrar el rol global (admin/usuario) y el rol por empresa en la tabla.
- En "Editar empresas": al añadir, usar el rol del usuario en otras empresas (consistencia "mismo rol").
- Reset de cache de organizaciones del propio usuario eliminado si aplica (no aplica porque borra a otros).

### 5. UX

- Banner en el diálogo de creación cuando se elige "Seleccionar todas": "Como admin global, se asignará a las 23 empresas".
- Botón "Eliminar usuario" con confirmación que liste lo que se borrará.

## Archivos a tocar

- `supabase/functions/create-user/index.ts`
- `supabase/functions/delete-user/index.ts`
- `supabase/migrations/<nuevo>.sql` (CASCADE FKs + drop trigger `handle_new_user_organization`)
- `src/pages/UsersManagement.tsx`
- `src/hooks/useUserManagementData.ts` (incluir rol por empresa en la respuesta)

## Notas técnicas

- Las FKs actuales en `public.*` apuntan a `auth.users`; al recrearlas con `ON DELETE CASCADE` se hará en una sola transacción para evitar downtime.
- `audit_log` mantiene `user_id` pero como `ON DELETE SET NULL` para preservar trazabilidad histórica.
- Compatibilidad: si el cliente sigue mandando `organization_id` único, `create-user` lo trata como array de uno.
- Sin cambios a las políticas RLS existentes (ya soportan admin global).

## Fuera de alcance

- Cambiar el esquema de roles (`owner/admin/member/viewer`) o reasignar permisos.
- Onboarding/auto-creación de organizaciones para signups públicos (queda deshabilitado pero la función permanece por si más adelante se reactiva con otro flujo).
