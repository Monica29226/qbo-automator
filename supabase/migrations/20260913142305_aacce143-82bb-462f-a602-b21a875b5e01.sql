REVOKE EXECUTE ON FUNCTION public.get_integration_accounts(uuid, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_integration_accounts(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_integration_accounts(uuid, boolean) TO authenticated;