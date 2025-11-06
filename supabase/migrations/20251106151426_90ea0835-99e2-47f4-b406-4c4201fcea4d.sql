-- Drop all existing INSERT policies on organizations
DROP POLICY IF EXISTS allow_authenticated_insert ON public.organizations;
DROP POLICY IF EXISTS "Users can create organizations" ON public.organizations;
DROP POLICY IF EXISTS "Authenticated users can create organizations" ON public.organizations;

-- Create a clear INSERT policy for authenticated users
CREATE POLICY "authenticated_users_can_insert_organizations"
ON public.organizations
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

-- Verify SELECT and UPDATE policies exist
DO $$
BEGIN
  -- Ensure SELECT policy exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'organizations' 
    AND policyname = 'allow_member_select'
  ) THEN
    CREATE POLICY allow_member_select
    ON public.organizations
    FOR SELECT
    USING (id IN (
      SELECT organization_id
      FROM public.organization_members
      WHERE user_id = auth.uid() AND is_active = true
    ));
  END IF;

  -- Ensure UPDATE policy exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'organizations' 
    AND policyname = 'allow_admin_update'
  ) THEN
    CREATE POLICY allow_admin_update
    ON public.organizations
    FOR UPDATE
    USING (EXISTS (
      SELECT 1
      FROM public.organization_members
      WHERE organization_id = organizations.id
        AND user_id = auth.uid()
        AND role IN ('owner', 'admin')
        AND is_active = true
    ));
  END IF;
END $$;