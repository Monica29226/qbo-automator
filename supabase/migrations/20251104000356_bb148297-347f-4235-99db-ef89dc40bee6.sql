-- Eliminar política existente
DROP POLICY IF EXISTS "Users can create organizations" ON public.organizations;

-- Recrear política de INSERT para organizaciones con el permiso correcto
CREATE POLICY "Users can create organizations" 
ON public.organizations 
FOR INSERT 
TO authenticated
WITH CHECK (true);

COMMENT ON POLICY "Users can create organizations" ON public.organizations IS 
'Permite a cualquier usuario autenticado crear nuevas organizaciones';