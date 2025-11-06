-- Drop the existing policy
DROP POLICY IF EXISTS allow_authenticated_insert ON public.organizations;

-- Create new policy with explicit authentication check
CREATE POLICY allow_authenticated_insert 
ON public.organizations
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);