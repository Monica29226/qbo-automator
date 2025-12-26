-- Eliminar política restrictiva existente
DROP POLICY IF EXISTS "org_insert_authenticated" ON public.organizations;

-- Crear política PERMISSIVE para INSERT
CREATE POLICY "org_insert_allow_authenticated" 
ON public.organizations 
FOR INSERT 
TO authenticated
WITH CHECK (true);