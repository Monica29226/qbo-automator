-- Eliminar todas las políticas existentes de organizations
DROP POLICY IF EXISTS "Users can create organizations" ON public.organizations;
DROP POLICY IF EXISTS "Organization admins can update" ON public.organizations;
DROP POLICY IF EXISTS "Users can view their organizations" ON public.organizations;

-- Crear política de INSERT (crear organizaciones)
CREATE POLICY "authenticated_users_can_insert_organizations" 
ON public.organizations 
FOR INSERT 
TO authenticated
WITH CHECK (true);

-- Crear política de SELECT (ver organizaciones donde es miembro)
CREATE POLICY "users_can_view_member_organizations" 
ON public.organizations 
FOR SELECT 
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_members.organization_id = organizations.id
      AND organization_members.user_id = auth.uid()
      AND organization_members.is_active = true
  )
);

-- Crear política de UPDATE (admins pueden actualizar)
CREATE POLICY "admins_can_update_organizations" 
ON public.organizations 
FOR UPDATE 
TO authenticated
USING (
  is_organization_admin(auth.uid(), id)
)
WITH CHECK (
  is_organization_admin(auth.uid(), id)
);

COMMENT ON POLICY "authenticated_users_can_insert_organizations" ON public.organizations IS 
'Permite a usuarios autenticados crear organizaciones';

COMMENT ON POLICY "users_can_view_member_organizations" ON public.organizations IS 
'Los usuarios pueden ver organizaciones donde son miembros activos';

COMMENT ON POLICY "admins_can_update_organizations" ON public.organizations IS 
'Los administradores pueden actualizar sus organizaciones';