DROP FUNCTION IF EXISTS public.get_integration_accounts(uuid, boolean);

CREATE OR REPLACE FUNCTION public.get_integration_accounts(
  _org_id uuid,
  _include_inactive boolean DEFAULT false
)
RETURNS TABLE(
  id uuid,
  organization_id uuid,
  service_type text,
  account_email text,
  account_name text,
  is_active boolean,
  expires_at bigint,
  realm_id text,
  sync_from timestamp with time zone,
  has_credentials boolean,
  meta jsonb,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.is_organization_member(auth.uid(), _org_id) OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  SELECT
    ia.id,
    ia.organization_id,
    ia.service_type,
    ia.account_email,
    ia.account_name,
    ia.is_active,
    CASE
      WHEN (ia.credentials->>'expires_at') ~ '^[0-9]+$'
        THEN (ia.credentials->>'expires_at')::bigint
      ELSE NULL
    END AS expires_at,
    ia.credentials->>'realm_id' AS realm_id,
    ia.sync_from,
    (ia.credentials IS NOT NULL AND ia.credentials <> '{}'::jsonb) AS has_credentials,
    COALESCE(ia.credentials, '{}'::jsonb)
      - 'password' - 'access_token' - 'refresh_token' - 'id_token'
      - 'client_secret' - 'token' - 'app_password' - 'pin' AS meta,
    ia.created_at,
    ia.updated_at
  FROM public.integration_accounts ia
  WHERE ia.organization_id = _org_id
    AND (_include_inactive OR ia.is_active = true)
  ORDER BY ia.service_type;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_integration_accounts(uuid, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_integration_accounts(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_integration_accounts(uuid, boolean) TO authenticated;