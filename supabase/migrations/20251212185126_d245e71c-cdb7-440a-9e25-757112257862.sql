-- RECONSTRUIR COMPLETAMENTE las políticas RLS de las 3 tablas

-- 1. ORGANIZATIONS - Eliminar TODAS las políticas existentes y recrear
DROP POLICY IF EXISTS "Allow authenticated users to create organizations" ON public.organizations;
DROP POLICY IF EXISTS "Authenticated users can create organizations" ON public.organizations;
DROP POLICY IF EXISTS "Users can create organizations" ON public.organizations;
DROP POLICY IF EXISTS "Members can view their organizations" ON public.organizations;
DROP POLICY IF EXISTS "Admins can update organization details" ON public.organizations;
DROP POLICY IF EXISTS "Only owners can delete organizations" ON public.organizations;

-- Recrear políticas de organizations con TO authenticated explícito
CREATE POLICY "org_insert_authenticated"
ON public.organizations FOR INSERT TO authenticated
WITH CHECK (true);

CREATE POLICY "org_select_members"
ON public.organizations FOR SELECT TO authenticated
USING (id IN (
  SELECT organization_id FROM public.organization_members 
  WHERE user_id = auth.uid() AND is_active = true
));

CREATE POLICY "org_update_admins"
ON public.organizations FOR UPDATE TO authenticated
USING (public.is_organization_admin(auth.uid(), id));

CREATE POLICY "org_delete_owners"
ON public.organizations FOR DELETE TO authenticated
USING (public.is_organization_owner(auth.uid(), id));

-- 2. ORGANIZATION_MEMBERS - Eliminar TODAS y recrear
DROP POLICY IF EXISTS "Authenticated users can add themselves as owner" ON public.organization_members;
DROP POLICY IF EXISTS "Users can add themselves as owners to any org" ON public.organization_members;
DROP POLICY IF EXISTS "Admins can add members to their org" ON public.organization_members;
DROP POLICY IF EXISTS "Users can accept their own invitations" ON public.organization_members;
DROP POLICY IF EXISTS "Users can view members of their organizations" ON public.organization_members;
DROP POLICY IF EXISTS "Admins can update members" ON public.organization_members;
DROP POLICY IF EXISTS "Admins can delete members" ON public.organization_members;

-- Recrear políticas de organization_members
CREATE POLICY "om_insert_self_as_owner"
ON public.organization_members FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND role = 'owner');

CREATE POLICY "om_insert_admin_adds_member"
ON public.organization_members FOR INSERT TO authenticated
WITH CHECK (public.is_organization_admin(auth.uid(), organization_id));

CREATE POLICY "om_insert_accept_invitation"
ON public.organization_members FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id AND 
  EXISTS (
    SELECT 1 FROM public.organization_invitations
    WHERE organization_id = organization_members.organization_id
      AND email = (SELECT email FROM auth.users WHERE id = auth.uid())
      AND accepted_at IS NULL
      AND expires_at > now()
  )
);

CREATE POLICY "om_select_members"
ON public.organization_members FOR SELECT TO authenticated
USING (public.is_organization_member(auth.uid(), organization_id));

CREATE POLICY "om_update_admins"
ON public.organization_members FOR UPDATE TO authenticated
USING (public.is_organization_admin(auth.uid(), organization_id));

CREATE POLICY "om_delete_admins"
ON public.organization_members FOR DELETE TO authenticated
USING (public.is_organization_admin(auth.uid(), organization_id));

-- 3. USER_ACTIVE_ORGANIZATION - Eliminar y recrear
DROP POLICY IF EXISTS "Users manage own active org" ON public.user_active_organization;
DROP POLICY IF EXISTS "Users can manage their own active organization" ON public.user_active_organization;
DROP POLICY IF EXISTS "Users can set their active organization" ON public.user_active_organization;

CREATE POLICY "uao_all_own"
ON public.user_active_organization FOR ALL TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());