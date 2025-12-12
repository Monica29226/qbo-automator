-- Eliminar todas las políticas INSERT existentes de organizations
DROP POLICY IF EXISTS "Authenticated users can create organizations" ON public.organizations;
DROP POLICY IF EXISTS "Users can create organizations" ON public.organizations;

-- Crear política INSERT correcta con rol authenticated explícito
CREATE POLICY "Allow authenticated users to create organizations"
ON public.organizations
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Verificar también que las políticas de organization_members son correctas
DROP POLICY IF EXISTS "Users can add themselves as owners to any org" ON public.organization_members;

CREATE POLICY "Authenticated users can add themselves as owner"
ON public.organization_members
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid() AND role = 'owner'
);

-- Verificar user_active_organization
DROP POLICY IF EXISTS "Users can manage their own active organization" ON public.user_active_organization;
DROP POLICY IF EXISTS "Users can set their active organization" ON public.user_active_organization;

CREATE POLICY "Users manage own active org"
ON public.user_active_organization
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());