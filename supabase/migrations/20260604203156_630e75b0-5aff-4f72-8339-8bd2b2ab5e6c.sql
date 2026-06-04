CREATE OR REPLACE FUNCTION public.get_email_provider_health(_org_id uuid)
RETURNS TABLE(service_type text, is_active boolean, has_credentials boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ia.service_type,
    ia.is_active,
    CASE
      WHEN ia.service_type IN ('gmail','outlook','outlook_imap')
        THEN (ia.credentials ? 'refresh_token')
      WHEN ia.service_type IN ('bluehost','hostinger')
        THEN (ia.credentials ? 'password' AND ia.credentials ? 'imap_host')
      ELSE false
    END AS has_credentials
  FROM public.integration_accounts ia
  WHERE ia.organization_id = _org_id
    AND ia.is_active = true
    AND ia.service_type = ANY(ARRAY['gmail','outlook','outlook_imap','bluehost','hostinger'])
    AND public.is_organization_member(auth.uid(), _org_id);
$$;

GRANT EXECUTE ON FUNCTION public.get_email_provider_health(uuid) TO authenticated;