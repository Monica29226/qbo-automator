-- Eliminar política existente y crear una correcta PERMISSIVE
DROP POLICY IF EXISTS "org_insert_authenticated" ON public.organizations;

-- Crear política de INSERT verdaderamente permissive para usuarios autenticados
CREATE POLICY "org_insert_authenticated" 
ON public.organizations 
FOR INSERT 
TO authenticated
WITH CHECK (true);