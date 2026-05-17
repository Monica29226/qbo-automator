CREATE OR REPLACE FUNCTION public.get_active_email_services(_org_id uuid)
 RETURNS TABLE(service_type text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT ia.service_type
  FROM public.integration_accounts ia
  WHERE ia.organization_id = _org_id
    AND ia.is_active = true
    AND ia.service_type = ANY(ARRAY['gmail','outlook','outlook_imap','hostinger','bluehost'])
    AND public.is_organization_member(auth.uid(), _org_id);
$function$;