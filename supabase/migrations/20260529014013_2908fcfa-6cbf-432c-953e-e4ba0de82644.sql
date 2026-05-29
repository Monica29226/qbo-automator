
-- Tighten profiles SELECT: only self + platform admins
DROP POLICY IF EXISTS "Users can view profiles in their organizations" ON public.profiles;

CREATE POLICY "Users can view their own profile"
ON public.profiles
FOR SELECT
TO authenticated
USING (id = auth.uid());

CREATE POLICY "Platform admins can view all profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Safe RPC to list org member profiles with only non-sensitive columns
CREATE OR REPLACE FUNCTION public.get_organization_member_profiles(_org_id uuid)
RETURNS TABLE (
  id uuid,
  email text,
  full_name text,
  avatar_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.email, p.full_name, p.avatar_url
  FROM public.profiles p
  JOIN public.organization_members om ON om.user_id = p.id
  WHERE om.organization_id = _org_id
    AND om.is_active = true
    AND public.is_organization_member(auth.uid(), _org_id);
$$;

REVOKE ALL ON FUNCTION public.get_organization_member_profiles(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_organization_member_profiles(uuid) TO authenticated;
