-- Fix organization_members policies to allow self-addition
DROP POLICY IF EXISTS "Only owners and admins can manage members" ON public.organization_members;
DROP POLICY IF EXISTS "Users can add themselves as organization members" ON public.organization_members;

-- Allow users to add themselves as members (this must be checked first)
CREATE POLICY "Users can add themselves as members" 
ON public.organization_members
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

-- Allow admins to manage other members (UPDATE and DELETE only, not INSERT)
CREATE POLICY "Admins can update members" 
ON public.organization_members
FOR UPDATE
USING (is_organization_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can delete members" 
ON public.organization_members
FOR DELETE
USING (is_organization_admin(auth.uid(), organization_id));