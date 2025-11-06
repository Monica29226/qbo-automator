-- Drop existing INSERT policy if it has issues
DROP POLICY IF EXISTS "authenticated_users_can_insert_organizations" ON public.organizations;

-- Recreate INSERT policy for organizations
CREATE POLICY "Users can create organizations" 
ON public.organizations 
FOR INSERT 
TO authenticated
WITH CHECK (true);

-- Ensure UPDATE policy exists
DROP POLICY IF EXISTS "Admins can update organization details" ON public.organizations;
CREATE POLICY "Admins can update organization details" 
ON public.organizations 
FOR UPDATE 
TO authenticated
USING (is_organization_admin(auth.uid(), id));