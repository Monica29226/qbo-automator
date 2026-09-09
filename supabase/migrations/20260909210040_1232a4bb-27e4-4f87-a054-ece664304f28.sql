DROP FUNCTION IF EXISTS public.compras_formato_gti(date, date);
REVOKE ALL ON FUNCTION public.compras_formato_gti(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compras_formato_gti(date, date, uuid) TO authenticated, service_role;