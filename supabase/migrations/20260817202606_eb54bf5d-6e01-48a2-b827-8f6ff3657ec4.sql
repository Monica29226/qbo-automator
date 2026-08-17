CREATE OR REPLACE FUNCTION public.grant_global_admins_new_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.organization_members (organization_id, user_id, role, is_active)
  SELECT NEW.id, ur.user_id, 'admin', true
  FROM public.user_roles ur
  WHERE ur.role = 'admin'
  ON CONFLICT (organization_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_organization_created_grant_admins ON public.organizations;
CREATE TRIGGER on_organization_created_grant_admins
AFTER INSERT ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.grant_global_admins_new_organization();

-- Backfill: give every global admin access to all existing active organizations
INSERT INTO public.organization_members (organization_id, user_id, role, is_active)
SELECT o.id, ur.user_id, 'admin', true
FROM public.organizations o
CROSS JOIN public.user_roles ur
WHERE ur.role = 'admin' AND o.is_active = true
ON CONFLICT (organization_id, user_id) DO NOTHING;