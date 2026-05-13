
-- 1. password_reset_tokens: restrict to service role only
DROP POLICY IF EXISTS "Service role manages password reset tokens" ON public.password_reset_tokens;
CREATE POLICY "Service role manages password reset tokens"
  ON public.password_reset_tokens
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 2. rate_limits: restrict to service role only
DROP POLICY IF EXISTS "Service role manages rate limits" ON public.rate_limits;
CREATE POLICY "Service role manages rate limits"
  ON public.rate_limits
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 3. oauth_credentials: remove client SELECT access (only service role reads secrets).
-- Keep admin INSERT/UPDATE/DELETE so admins can still configure credentials via the app.
DROP POLICY IF EXISTS "Admins can view oauth credentials" ON public.oauth_credentials;

-- 4. integration_accounts: remove broad member SELECT and admin SELECT access from client.
-- Service role (edge functions) reads credentials. Admins keep INSERT/UPDATE/DELETE via the existing ALL policy.
DROP POLICY IF EXISTS "Organization members can view integration accounts" ON public.integration_accounts;
DROP POLICY IF EXISTS "Admins can manage integrations" ON public.integration_accounts;
CREATE POLICY "Admins can insert integrations"
  ON public.integration_accounts
  FOR INSERT
  TO authenticated
  WITH CHECK (is_organization_admin(auth.uid(), organization_id));
CREATE POLICY "Admins can update integrations"
  ON public.integration_accounts
  FOR UPDATE
  TO authenticated
  USING (is_organization_admin(auth.uid(), organization_id))
  WITH CHECK (is_organization_admin(auth.uid(), organization_id));
CREATE POLICY "Admins can delete integrations"
  ON public.integration_accounts
  FOR DELETE
  TO authenticated
  USING (is_organization_admin(auth.uid(), organization_id));
-- Allow members to see only non-sensitive metadata via a safe view if needed in future.
-- For now, only service role can SELECT credentials.

-- 5. audit_log: restrict INSERT to org members for the given organization_id
DROP POLICY IF EXISTS "Authenticated users can insert audit logs" ON public.audit_log;
CREATE POLICY "Members can insert audit logs for their org"
  ON public.audit_log
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (
      organization_id IS NULL
      OR is_organization_member(auth.uid(), organization_id)
    )
  );

-- 6. organization_members: prevent claiming ownership of an org that already has an owner
DROP POLICY IF EXISTS "om_insert_self_as_owner" ON public.organization_members;
CREATE POLICY "om_insert_self_as_owner"
  ON public.organization_members
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND role = 'owner'
    AND NOT EXISTS (
      SELECT 1 FROM public.organization_members existing
      WHERE existing.organization_id = organization_members.organization_id
        AND existing.role = 'owner'
        AND existing.is_active = true
    )
  );
