-- 1) Remove the self-as-owner insert policy that enables privilege escalation.
-- Organization creation goes through the create-organization edge function and the
-- handle_new_user_organization trigger, both of which use elevated privileges and
-- bypass RLS, so no client flow depends on this policy.
DROP POLICY IF EXISTS om_insert_self_as_owner ON public.organization_members;

-- 2) Lock down realtime.messages (used by Realtime broadcast/presence channel auth).
-- The app only uses postgres_changes subscriptions, which are authorized via the
-- underlying tables' RLS — not via realtime.messages. Deny all client access.
ALTER TABLE IF EXISTS realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny all client access to realtime.messages" ON realtime.messages;
CREATE POLICY "Deny all client access to realtime.messages"
ON realtime.messages
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (false)
WITH CHECK (false);