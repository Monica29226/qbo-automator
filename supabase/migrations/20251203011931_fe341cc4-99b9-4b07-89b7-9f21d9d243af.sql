-- =====================================================
-- SECURITY FIX: RLS Policies Corrections
-- =====================================================

-- 1. Fix organizations policy - only members can view
DROP POLICY IF EXISTS "allow_member_select" ON public.organizations;
CREATE POLICY "Members can view their organizations"
ON public.organizations
FOR SELECT
USING (
  id IN (
    SELECT organization_id 
    FROM public.organization_members 
    WHERE user_id = auth.uid() 
    AND is_active = true
  )
);

-- 2. Fix profiles policy - only view profiles in same organizations
DROP POLICY IF EXISTS "Profiles are viewable by authenticated users" ON public.profiles;
CREATE POLICY "Users can view profiles in their organizations"
ON public.profiles
FOR SELECT
USING (
  id = auth.uid() OR
  id IN (
    SELECT om2.user_id 
    FROM public.organization_members om1
    JOIN public.organization_members om2 ON om1.organization_id = om2.organization_id
    WHERE om1.user_id = auth.uid() 
    AND om1.is_active = true 
    AND om2.is_active = true
  )
);

-- 3. Fix organization_members - prevent unauthorized self-addition
DROP POLICY IF EXISTS "Users can add themselves as members" ON public.organization_members;
CREATE POLICY "Users can join via invitation or admin"
ON public.organization_members
FOR INSERT
WITH CHECK (
  -- User must be admin of the organization OR
  public.is_organization_admin(auth.uid(), organization_id) OR
  -- User is accepting an invitation for themselves
  (auth.uid() = user_id AND EXISTS (
    SELECT 1 FROM public.organization_invitations
    WHERE organization_id = organization_members.organization_id
    AND email = (SELECT email FROM auth.users WHERE id = auth.uid())
    AND accepted_at IS NULL
    AND expires_at > now()
  ))
);

-- 4. Fix sync_logs INSERT policy - only service role or system
DROP POLICY IF EXISTS "System can insert sync logs" ON public.sync_logs;
CREATE POLICY "Organization members can insert sync logs"
ON public.sync_logs
FOR INSERT
WITH CHECK (
  public.is_organization_member(auth.uid(), organization_id)
);

-- 5. Fix sync_logs UPDATE policy
DROP POLICY IF EXISTS "System can update sync logs" ON public.sync_logs;
CREATE POLICY "Organization members can update sync logs"
ON public.sync_logs
FOR UPDATE
USING (
  public.is_organization_member(auth.uid(), organization_id)
);

-- 6. Fix alert_history INSERT policy
DROP POLICY IF EXISTS "System can insert alerts" ON public.alert_history;
CREATE POLICY "Organization members can insert alerts"
ON public.alert_history
FOR INSERT
WITH CHECK (
  public.is_organization_member(auth.uid(), organization_id)
);

-- 7. Add validation for user_active_organization changes
CREATE OR REPLACE FUNCTION public.validate_active_organization_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify user is member of the organization they're switching to
  IF NEW.organization_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = NEW.user_id
    AND organization_id = NEW.organization_id
    AND is_active = true
  ) THEN
    RAISE EXCEPTION 'User is not a member of this organization';
  END IF;
  RETURN NEW;
END;
$$;

-- Create trigger for validation
DROP TRIGGER IF EXISTS validate_active_org_change ON public.user_active_organization;
CREATE TRIGGER validate_active_org_change
  BEFORE INSERT OR UPDATE ON public.user_active_organization
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_active_organization_change();

-- 8. Create audit_log table for security monitoring
CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id),
  organization_id uuid REFERENCES public.organizations(id),
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  details jsonb DEFAULT '{}',
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on audit_log
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Only admins can view audit logs for their organization
CREATE POLICY "Admins can view organization audit logs"
ON public.audit_log
FOR SELECT
USING (
  public.is_organization_admin(auth.uid(), organization_id)
);

-- System can insert audit logs (via service role)
CREATE POLICY "Authenticated users can insert audit logs"
ON public.audit_log
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

-- Create index for efficient querying
CREATE INDEX IF NOT EXISTS idx_audit_log_org_created 
ON public.audit_log(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_user_created 
ON public.audit_log(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_action 
ON public.audit_log(action, created_at DESC);

-- 9. Add rate limiting tracking table
CREATE TABLE IF NOT EXISTS public.rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,
  endpoint text NOT NULL,
  request_count integer DEFAULT 1,
  window_start timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(identifier, endpoint, window_start)
);

-- Enable RLS
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- Service role only for rate limits
CREATE POLICY "Service role manages rate limits"
ON public.rate_limits
FOR ALL
USING (true)
WITH CHECK (true);

-- Index for rate limit lookups
CREATE INDEX IF NOT EXISTS idx_rate_limits_lookup 
ON public.rate_limits(identifier, endpoint, window_start DESC);