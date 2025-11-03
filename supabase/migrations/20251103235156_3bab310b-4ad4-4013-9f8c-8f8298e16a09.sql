-- Permitir a usuarios autenticados crear organizaciones
CREATE POLICY "Users can create organizations" 
ON public.organizations 
FOR INSERT 
TO authenticated
WITH CHECK (true);

-- Permitir a usuarios autenticados crear membresías para organizaciones que ellos crearon
CREATE POLICY "Users can add themselves as organization members" 
ON public.organization_members 
FOR INSERT 
TO authenticated
WITH CHECK (auth.uid() = user_id);

COMMENT ON POLICY "Users can create organizations" ON public.organizations IS 
'Permite a cualquier usuario autenticado crear nuevas organizaciones';

COMMENT ON POLICY "Users can add themselves as organization members" ON public.organization_members IS 
'Permite a los usuarios agregarse como miembros de organizaciones que crean';