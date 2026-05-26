
CREATE OR REPLACE FUNCTION public.sync_org_connection_flags()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org_id uuid;
BEGIN
  _org_id := COALESCE(NEW.organization_id, OLD.organization_id);

  UPDATE public.organizations o SET
    gmail_connected     = EXISTS (SELECT 1 FROM public.integration_accounts ia WHERE ia.organization_id = _org_id AND ia.is_active AND ia.service_type = 'gmail'),
    outlook_connected   = EXISTS (SELECT 1 FROM public.integration_accounts ia WHERE ia.organization_id = _org_id AND ia.is_active AND ia.service_type IN ('outlook','outlook_imap')),
    hostinger_connected = EXISTS (SELECT 1 FROM public.integration_accounts ia WHERE ia.organization_id = _org_id AND ia.is_active AND ia.service_type = 'hostinger'),
    bluehost_connected  = EXISTS (SELECT 1 FROM public.integration_accounts ia WHERE ia.organization_id = _org_id AND ia.is_active AND ia.service_type = 'bluehost'),
    updated_at = now()
  WHERE o.id = _org_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_org_connection_flags ON public.integration_accounts;
CREATE TRIGGER trg_sync_org_connection_flags
AFTER INSERT OR UPDATE OR DELETE ON public.integration_accounts
FOR EACH ROW EXECUTE FUNCTION public.sync_org_connection_flags();

-- Resync existing organizations now
UPDATE public.organizations o SET
  gmail_connected     = EXISTS (SELECT 1 FROM public.integration_accounts ia WHERE ia.organization_id = o.id AND ia.is_active AND ia.service_type = 'gmail'),
  outlook_connected   = EXISTS (SELECT 1 FROM public.integration_accounts ia WHERE ia.organization_id = o.id AND ia.is_active AND ia.service_type IN ('outlook','outlook_imap')),
  hostinger_connected = EXISTS (SELECT 1 FROM public.integration_accounts ia WHERE ia.organization_id = o.id AND ia.is_active AND ia.service_type = 'hostinger'),
  bluehost_connected  = EXISTS (SELECT 1 FROM public.integration_accounts ia WHERE ia.organization_id = o.id AND ia.is_active AND ia.service_type = 'bluehost');
