-- Update SELECT policy to allow viewing newly created organizations
DROP POLICY IF EXISTS "allow_member_select" ON public.organizations;

CREATE POLICY "allow_member_select" 
ON public.organizations 
FOR SELECT 
USING (
  -- Organizations where user is a member
  id IN (
    SELECT organization_id 
    FROM public.organization_members
    WHERE user_id = auth.uid() 
      AND is_active = true
  )
  OR
  -- Organizations with no members yet (newly created)
  NOT EXISTS (
    SELECT 1 
    FROM public.organization_members 
    WHERE organization_id = id
  )
);