DROP POLICY IF EXISTS "om_insert_accept_invitation" ON public.organization_members;

CREATE POLICY "om_insert_accept_invitation"
ON public.organization_members
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1
    FROM public.organization_invitations oi
    WHERE oi.organization_id = organization_members.organization_id
      AND oi.email = (SELECT u.email FROM auth.users u WHERE u.id = auth.uid())::text
      AND oi.accepted_at IS NULL
      AND oi.expires_at > now()
      AND oi.role = organization_members.role
  )
);