-- Drop ALL existing policies
DROP POLICY IF EXISTS "Admins can manage integrations" ON public.integration_accounts;
DROP POLICY IF EXISTS "Organization members can view integration accounts" ON public.integration_accounts;
DROP POLICY IF EXISTS "Admins can delete oauth credentials" ON public.oauth_credentials;
DROP POLICY IF EXISTS "Admins can insert oauth credentials" ON public.oauth_credentials;
DROP POLICY IF EXISTS "Admins can update oauth credentials" ON public.oauth_credentials;
DROP POLICY IF EXISTS "Admins can view oauth credentials" ON public.oauth_credentials;
DROP POLICY IF EXISTS "Only owners and admins can manage members" ON public.organization_members;
DROP POLICY IF EXISTS "Users can add themselves as organization members" ON public.organization_members;
DROP POLICY IF EXISTS "Users can view members of their organizations" ON public.organization_members;
DROP POLICY IF EXISTS "Admins can update organization details" ON public.organizations;
DROP POLICY IF EXISTS "Only owners can delete organizations" ON public.organizations;
DROP POLICY IF EXISTS "allow_member_select" ON public.organizations;
DROP POLICY IF EXISTS "authenticated_users_can_insert_organizations" ON public.organizations;
DROP POLICY IF EXISTS "Members and above can create documents" ON public.processed_documents;
DROP POLICY IF EXISTS "Members and above can update documents" ON public.processed_documents;
DROP POLICY IF EXISTS "Members can view organization documents" ON public.processed_documents;
DROP POLICY IF EXISTS "Only admins can delete documents" ON public.processed_documents;
DROP POLICY IF EXISTS "Admins can delete settings" ON public.system_settings;
DROP POLICY IF EXISTS "Admins can insert settings" ON public.system_settings;
DROP POLICY IF EXISTS "Admins can update settings" ON public.system_settings;
DROP POLICY IF EXISTS "Members can view organization settings" ON public.system_settings;
DROP POLICY IF EXISTS "Admins can manage classification rules" ON public.vendor_classification_rules;
DROP POLICY IF EXISTS "Members can view classification rules" ON public.vendor_classification_rules;
DROP POLICY IF EXISTS "Admins can delete vendors" ON public.vendors;
DROP POLICY IF EXISTS "Admins can insert vendors" ON public.vendors;
DROP POLICY IF EXISTS "Admins can update vendors" ON public.vendors;
DROP POLICY IF EXISTS "Members can view organization vendors" ON public.vendors;

-- Drop and recreate constraint for role validation
ALTER TABLE public.organization_members DROP CONSTRAINT IF EXISTS valid_organization_role;
ALTER TABLE public.organization_members
ADD CONSTRAINT valid_organization_role 
CHECK (role IN ('owner', 'admin', 'member', 'viewer'));

-- Recreate helper functions for role-based permissions
CREATE OR REPLACE FUNCTION public.is_organization_owner(_user_id uuid, _org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE user_id = _user_id
      AND organization_id = _org_id
      AND role = 'owner'
      AND is_active = true
  )
$$;

CREATE OR REPLACE FUNCTION public.is_organization_admin(_user_id uuid, _org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE user_id = _user_id
      AND organization_id = _org_id
      AND role IN ('owner', 'admin')
      AND is_active = true
  )
$$;

CREATE OR REPLACE FUNCTION public.can_edit_organization_content(_user_id uuid, _org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE user_id = _user_id
      AND organization_id = _org_id
      AND role IN ('owner', 'admin', 'member')
      AND is_active = true
  )
$$;

-- Organizations policies
CREATE POLICY "allow_member_select" ON public.organizations
FOR SELECT USING (id IN (
  SELECT organization_id FROM public.organization_members
  WHERE user_id = auth.uid() AND is_active = true
));

CREATE POLICY "authenticated_users_can_insert_organizations" ON public.organizations
FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can update organization details" ON public.organizations
FOR UPDATE USING (is_organization_admin(auth.uid(), id));

CREATE POLICY "Only owners can delete organizations" ON public.organizations
FOR DELETE USING (is_organization_owner(auth.uid(), id));

-- Organization members policies
CREATE POLICY "Users can view members of their organizations" ON public.organization_members
FOR SELECT USING (is_organization_member(auth.uid(), organization_id));

CREATE POLICY "Only owners and admins can manage members" ON public.organization_members
FOR ALL USING (is_organization_admin(auth.uid(), organization_id))
WITH CHECK (is_organization_admin(auth.uid(), organization_id));

CREATE POLICY "Users can add themselves as organization members" ON public.organization_members
FOR INSERT WITH CHECK (auth.uid() = user_id);

-- OAuth credentials policies
CREATE POLICY "Admins can view oauth credentials" ON public.oauth_credentials
FOR SELECT USING (is_organization_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can insert oauth credentials" ON public.oauth_credentials
FOR INSERT WITH CHECK (is_organization_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can update oauth credentials" ON public.oauth_credentials
FOR UPDATE USING (is_organization_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can delete oauth credentials" ON public.oauth_credentials
FOR DELETE USING (is_organization_admin(auth.uid(), organization_id));

-- Integration accounts policies
CREATE POLICY "Organization members can view integration accounts" ON public.integration_accounts
FOR SELECT USING (is_organization_member(auth.uid(), organization_id));

CREATE POLICY "Admins can manage integrations" ON public.integration_accounts
FOR ALL USING (is_organization_admin(auth.uid(), organization_id))
WITH CHECK (is_organization_admin(auth.uid(), organization_id));

-- Processed documents policies
CREATE POLICY "Members can view organization documents" ON public.processed_documents
FOR SELECT USING (is_organization_member(auth.uid(), organization_id));

CREATE POLICY "Members and above can create documents" ON public.processed_documents
FOR INSERT WITH CHECK (can_edit_organization_content(auth.uid(), organization_id));

CREATE POLICY "Members and above can update documents" ON public.processed_documents
FOR UPDATE USING (can_edit_organization_content(auth.uid(), organization_id));

CREATE POLICY "Only admins can delete documents" ON public.processed_documents
FOR DELETE USING (is_organization_admin(auth.uid(), organization_id));

-- Vendors policies
CREATE POLICY "Members can view organization vendors" ON public.vendors
FOR SELECT USING (is_organization_member(auth.uid(), organization_id));

CREATE POLICY "Admins can insert vendors" ON public.vendors
FOR INSERT WITH CHECK (is_organization_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can update vendors" ON public.vendors
FOR UPDATE USING (is_organization_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can delete vendors" ON public.vendors
FOR DELETE USING (is_organization_admin(auth.uid(), organization_id));

-- System settings policies
CREATE POLICY "Members can view organization settings" ON public.system_settings
FOR SELECT USING (is_organization_member(auth.uid(), organization_id));

CREATE POLICY "Admins can insert settings" ON public.system_settings
FOR INSERT WITH CHECK (is_organization_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can update settings" ON public.system_settings
FOR UPDATE USING (is_organization_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can delete settings" ON public.system_settings
FOR DELETE USING (is_organization_admin(auth.uid(), organization_id));

-- Vendor classification rules policies
CREATE POLICY "Members can view classification rules" ON public.vendor_classification_rules
FOR SELECT USING (is_organization_member(auth.uid(), organization_id));

CREATE POLICY "Admins can manage classification rules" ON public.vendor_classification_rules
FOR ALL USING (is_organization_admin(auth.uid(), organization_id))
WITH CHECK (is_organization_admin(auth.uid(), organization_id));