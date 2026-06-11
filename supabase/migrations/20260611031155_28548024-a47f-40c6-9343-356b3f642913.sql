
-- 1. Explicitly block client INSERTs on organizations (service_role bypasses RLS via edge functions)
DROP POLICY IF EXISTS "org_insert_block_clients" ON public.organizations;
CREATE POLICY "org_insert_block_clients"
ON public.organizations
FOR INSERT
TO authenticated, anon
WITH CHECK (false);

-- 2. Allow org admins to read hacienda certificate metadata
DROP POLICY IF EXISTS "Admins can view certificate metadata only" ON public.hacienda_certificates;
CREATE POLICY "Admins can view certificate metadata"
ON public.hacienda_certificates
FOR SELECT
TO authenticated
USING (public.is_organization_admin(auth.uid(), organization_id));
