
-- Allow global app admins to view/manage all organizations and memberships
CREATE POLICY "org_select_global_admins" ON public.organizations
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "org_update_global_admins" ON public.organizations
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "om_select_global_admins" ON public.organization_members
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "om_insert_global_admins" ON public.organization_members
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "om_update_global_admins" ON public.organization_members
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "om_delete_global_admins" ON public.organization_members
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "oi_select_global_admins" ON public.organization_invitations
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
