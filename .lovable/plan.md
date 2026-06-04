# Por qué Melissa no ve todas las empresas

Investigué la base de datos y el código de "Gestión de Usuarios":

- Melissa (`melissa@aclcostarica.com`) sólo tiene **2 membresías** en `organization_members`:
  - "Agricola Lloronal" (member)
  - "Mi Empresa" (owner)
- Existen **31 organizaciones** (19 activas) en el sistema.
- Cuando intentaste darle acceso "a todas", **no se crearon las filas** en `organization_members` para las demás empresas.

## Causa raíz

Las políticas RLS están escritas pensando solo en miembros, sin contemplar al **admin global** (rol `admin` en `user_roles`):

1. `organizations` → política `org_select_members`: solo devuelve organizaciones donde el usuario ya es miembro. Por eso el diálogo de "Editar empresas del usuario" mostraba solo el subconjunto de empresas del admin que estaba operando, no las 31. El botón "Seleccionar todas" solo seleccionaba las visibles.
2. `organization_members` → política `om_insert_admin_adds_member` exige `is_organization_admin(auth.uid(), organization_id)`, es decir, ser admin **de cada empresa** para agregar al usuario. Un admin global no cumple esto, así que aunque se intentara insertar, fallaría silenciosamente.

Resultado: el flujo no informó error visible y la asignación quedó solo en las pocas empresas donde el admin era miembro/admin.

## Plan de solución

### 1. Migración SQL — dar bypass al admin global

Agregar políticas adicionales (sin remover las existentes) usando `public.has_role(auth.uid(), 'admin')`:

- `organizations`: SELECT permitido si es admin global.
- `organization_members`: SELECT / INSERT / UPDATE / DELETE permitidos si es admin global.
- `organization_invitations`: SELECT permitido si es admin global (para que también vea invitaciones pendientes de todas las orgs).

Esto se alinea con la regla del proyecto "Admins can view all organizations".

### 2. Backfill de Melissa

Insertar membresías faltantes para Melissa en las 19 organizaciones activas restantes con `role='member'` e `is_active=true` (sin tocar las 2 que ya tiene). Las inactivas no se incluyen para no reactivar empresas archivadas; si quieres también esas, lo indicas.

### 3. Feedback en UI (frontend)

En `src/pages/UsersManagement.tsx` (`handleSaveUserOrgs`):
- Revisar el `error` devuelto por cada `insert`/`update` en `organization_members` y acumular fallos.
- Si hay fallos, mostrar `toast.error` con la cuenta de empresas que no se pudieron asignar (en lugar del actual "Empresas actualizadas correctamente" siempre verde).
- Después del fix de RLS, esto sirve como red de seguridad para futuros casos.

### 4. Verificación

Tras aplicar:
- Reabrir el diálogo "Editar Empresas" → deben aparecer las 19 activas.
- Melissa al iniciar sesión en `SelectCompany` verá las 19 empresas.

## Archivos afectados

- Nueva migración SQL (políticas RLS + backfill de Melissa).
- `src/pages/UsersManagement.tsx` (mejor manejo de errores en `handleSaveUserOrgs`).

¿Apruebo y procedo?
