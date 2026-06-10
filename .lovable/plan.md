## Problema

Al asignar varias empresas a Melissa Calderón, la base de datos rechaza la operación con "permission denied for table users".

**Causa raíz:** La regla de seguridad de aceptación de invitaciones en `organization_members` consulta directamente la tabla protegida `auth.users` para obtener el email del usuario. Esa tabla no es legible por usuarios normales, y como Postgres evalúa todas las reglas de inserción juntas, ese acceso prohibido aborta también las inserciones legítimas de administradores. (El mismo error ocurría antes con David — no es nuevo del ajuste de seguridad de hoy.)

## Solución

1. **Migración de base de datos** — Recrear la regla `om_insert_accept_invitation` reemplazando la consulta a `auth.users` por la función segura `auth.email()`, que devuelve el email del usuario autenticado sin tocar la tabla protegida. Se mantiene intacta la restricción de seguridad agregada hoy (el rol al unirse debe coincidir exactamente con el rol de la invitación).

2. **Verificación** — Confirmar que la nueva regla está activa y probar que un admin puede insertar membresías sin el error de permisos.

## Detalles técnicos

```sql
DROP POLICY IF EXISTS "om_insert_accept_invitation" ON public.organization_members;

CREATE POLICY "om_insert_accept_invitation"
ON public.organization_members
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM public.organization_invitations oi
    WHERE oi.organization_id = organization_members.organization_id
      AND oi.email = auth.email()
      AND oi.accepted_at IS NULL
      AND oi.expires_at > now()
      AND oi.role = organization_members.role
  )
);
```

Sin cambios de frontend: `UsersManagement.tsx` ya funciona correctamente una vez que la regla no falle.