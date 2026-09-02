CREATE OR REPLACE FUNCTION public.sync_org_connection_flags()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _org_id uuid;
BEGIN
  _org_id := COALESCE(NEW.organization_id, OLD.organization_id);

  UPDATE public.organizations o SET
    gmail_connected      = EXISTS (SELECT 1 FROM public.integration_accounts ia WHERE ia.organization_id = _org_id AND ia.is_active AND ia.service_type = 'gmail'),
    outlook_connected    = EXISTS (SELECT 1 FROM public.integration_accounts ia WHERE ia.organization_id = _org_id AND ia.is_active AND ia.service_type IN ('outlook','outlook_imap')),
    hostinger_connected  = EXISTS (SELECT 1 FROM public.integration_accounts ia WHERE ia.organization_id = _org_id AND ia.is_active AND ia.service_type = 'hostinger'),
    bluehost_connected   = EXISTS (SELECT 1 FROM public.integration_accounts ia WHERE ia.organization_id = _org_id AND ia.is_active AND ia.service_type = 'bluehost'),
    quickbooks_connected = EXISTS (SELECT 1 FROM public.integration_accounts ia WHERE ia.organization_id = _org_id AND ia.is_active AND ia.service_type = 'quickbooks'),
    updated_at = now()
  WHERE o.id = _org_id;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

UPDATE public.organizations o
SET quickbooks_connected = EXISTS (
      SELECT 1 FROM public.integration_accounts ia
      WHERE ia.organization_id = o.id AND ia.is_active AND ia.service_type = 'quickbooks'
    ),
    updated_at = now()
WHERE o.quickbooks_connected IS DISTINCT FROM EXISTS (
      SELECT 1 FROM public.integration_accounts ia
      WHERE ia.organization_id = o.id AND ia.is_active AND ia.service_type = 'quickbooks'
    );