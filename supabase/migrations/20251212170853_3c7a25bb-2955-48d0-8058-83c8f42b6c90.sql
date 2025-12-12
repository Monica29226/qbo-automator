-- Add policy to allow authenticated users to create organizations
CREATE POLICY "Authenticated users can create organizations"
ON public.organizations
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Ensure the trigger handle_new_user_organization can also insert (it runs as SECURITY DEFINER so should be ok)
-- But we also need to make sure organization_members allows the user to add themselves as owner after org creation

-- Add policy for organization_members INSERT (user can add themselves when creating an org)
DROP POLICY IF EXISTS "Users can add themselves to new organizations" ON public.organization_members;
CREATE POLICY "Users can add themselves to new organizations"
ON public.organization_members
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid() AND role = 'owner'
);

-- Add policy for user_active_organization INSERT/UPDATE
DROP POLICY IF EXISTS "Users can set their active organization" ON public.user_active_organization;
CREATE POLICY "Users can set their active organization"
ON public.user_active_organization
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());