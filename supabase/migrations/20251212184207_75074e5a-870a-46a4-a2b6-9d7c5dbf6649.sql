-- Primero, eliminar las políticas INSERT conflictivas de organization_members
DROP POLICY IF EXISTS "Users can add themselves to new organizations" ON public.organization_members;
DROP POLICY IF EXISTS "Users can join via invitation or admin" ON public.organization_members;

-- Crear una sola política INSERT clara para organization_members
-- Esta permite:
-- 1. Un usuario puede agregarse a sí mismo como owner de CUALQUIER organización (para crear nuevas orgs)
-- 2. Un admin puede agregar miembros a su organización
-- 3. Un usuario puede aceptar su propia invitación

CREATE POLICY "Users can add themselves as owners to any org"
ON public.organization_members
FOR INSERT
TO authenticated
WITH CHECK (
  -- El usuario puede agregarse a sí mismo como owner
  (user_id = auth.uid() AND role = 'owner')
);

CREATE POLICY "Admins can add members to their org"
ON public.organization_members
FOR INSERT
TO authenticated
WITH CHECK (
  -- Los admins pueden agregar otros miembros
  is_organization_admin(auth.uid(), organization_id)
);

CREATE POLICY "Users can accept their own invitations"
ON public.organization_members
FOR INSERT
TO authenticated
WITH CHECK (
  -- Usuario aceptando su propia invitación
  (auth.uid() = user_id) AND 
  EXISTS (
    SELECT 1
    FROM organization_invitations
    WHERE organization_invitations.organization_id = organization_members.organization_id
      AND organization_invitations.email = (SELECT email FROM auth.users WHERE id = auth.uid())
      AND organization_invitations.accepted_at IS NULL
      AND organization_invitations.expires_at > now()
  )
);