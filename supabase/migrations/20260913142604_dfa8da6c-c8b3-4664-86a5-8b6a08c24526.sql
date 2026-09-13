CREATE OR REPLACE FUNCTION public.set_siku_default_income_account(
  _org_id uuid,
  _account_ref text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.is_organization_admin(auth.uid(), _org_id) OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  UPDATE public.integration_accounts
  SET credentials = jsonb_set(
        COALESCE(credentials, '{}'::jsonb),
        '{default_income_account_ref}',
        CASE WHEN _account_ref IS NULL OR _account_ref = '' THEN 'null'::jsonb
             ELSE to_jsonb(_account_ref) END,
        true
      ),
      updated_at = now()
  WHERE organization_id = _org_id
    AND service_type = 'siku'
    AND is_active = true;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.set_siku_default_income_account(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_siku_default_income_account(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_siku_default_income_account(uuid, text) TO authenticated;