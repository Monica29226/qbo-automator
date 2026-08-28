CREATE OR REPLACE FUNCTION public.get_integration_accounts(_org_id uuid)
RETURNS TABLE(id uuid, service_type text, account_email text, account_name text, is_active boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_organization_member(auth.uid(), _org_id) OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  SELECT ia.id, ia.service_type, ia.account_email, ia.account_name, ia.is_active
  FROM public.integration_accounts ia
  WHERE ia.organization_id = _org_id
    AND ia.is_active = true
  ORDER BY ia.service_type;
END;
$$;

REVOKE ALL ON FUNCTION public.get_integration_accounts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_integration_accounts(uuid) TO authenticated;