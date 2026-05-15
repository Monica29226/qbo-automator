ALTER TABLE public.alert_history
  ADD COLUMN IF NOT EXISTS resolved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by uuid;

CREATE INDEX IF NOT EXISTS idx_alert_history_org_unresolved
  ON public.alert_history (organization_id, resolved, sent_at DESC);