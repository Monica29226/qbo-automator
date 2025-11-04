-- Verificar y limpiar TODAS las políticas de organizations
-- Primero, obtener todas las políticas
DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN 
        SELECT policyname 
        FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'organizations'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.organizations', pol.policyname);
    END LOOP;
END $$;

-- Ahora crear SOLO la política de INSERT más simple posible
CREATE POLICY "allow_authenticated_insert"
ON public.organizations
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Política para ver organizaciones donde es miembro
CREATE POLICY "allow_member_select"
ON public.organizations
FOR SELECT
TO authenticated
USING (
  id IN (
    SELECT organization_id 
    FROM public.organization_members 
    WHERE user_id = auth.uid() 
    AND is_active = true
  )
);

-- Política para actualizar (solo admins)
CREATE POLICY "allow_admin_update"
ON public.organizations
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 
    FROM public.organization_members 
    WHERE organization_id = organizations.id 
    AND user_id = auth.uid() 
    AND role IN ('owner', 'admin')
    AND is_active = true
  )
);

-- Verificar que RLS está habilitado
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;