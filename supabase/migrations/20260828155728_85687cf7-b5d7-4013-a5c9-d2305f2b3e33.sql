CREATE INDEX IF NOT EXISTS idx_sync_logs_org_started_at ON public.sync_logs (organization_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_logs_org_created_at ON public.sync_logs (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_logs_org_status_created_at ON public.sync_logs (organization_id, status, created_at DESC);
ANALYZE public.sync_logs;