CREATE OR REPLACE FUNCTION public.has_active_integration(_org_id uuid, _service_type text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.integration_accounts
    WHERE organization_id = _org_id
      AND service_type = _service_type
      AND is_active = true
  ) AND public.is_organization_member(auth.uid(), _org_id);
$$;

GRANT EXECUTE ON FUNCTION public.has_active_integration(uuid, text) TO authenticated;