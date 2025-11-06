-- Drop all policies that reference the role column
DROP POLICY IF EXISTS "allow_admin_update" ON public.organizations;
DROP POLICY IF EXISTS "Organization admins can view oauth credentials" ON public.oauth_credentials;
DROP POLICY IF EXISTS "Organization admins can insert oauth credentials" ON public.oauth_credentials;
DROP POLICY IF EXISTS "Organization admins can update oauth credentials" ON public.oauth_credentials;
DROP POLICY IF EXISTS "Organization admins can delete oauth credentials" ON public.oauth_credentials;
DROP POLICY IF EXISTS "Organization admins can manage members" ON public.organization_members;
DROP POLICY IF EXISTS "Users can add themselves as organization members" ON public.organization_members;
DROP POLICY IF EXISTS "Members can create organization documents" ON public.processed_documents;
DROP POLICY IF EXISTS "Admins can manage organization documents" ON public.processed_documents;
DROP POLICY IF EXISTS "Admins can manage organization vendors" ON public.vendors;
DROP POLICY IF EXISTS "Admins can manage organization settings" ON public.system_settings;
DROP POLICY IF EXISTS "Organization admins can manage integration accounts" ON public.integration_accounts;
DROP POLICY IF EXISTS "Admins can manage classification rules" ON public.vendor_classification_rules;

-- Add CHECK constraint to validate role values (keeping as text for simplicity)
ALTER TABLE public.organization_members
ADD CONSTRAINT valid_organization_role 
CHECK (role IN ('owner', 'admin', 'member', 'viewer'));

-- Create helper functions for role-based permissions
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

-- Recreate all RLS policies with proper permissions

-- Organizations policies
CREATE POLICY "Admins can update organization details"
ON public.organizations
FOR UPDATE
USING (is_organization_admin(auth.uid(), id));

CREATE POLICY "Only owners can delete organizations"
ON public.organizations
FOR DELETE
USING (is_organization_owner(auth.uid(), id));

-- OAuth credentials policies
CREATE POLICY "Admins can view oauth credentials"
ON public.oauth_credentials
FOR SELECT
USING (is_organization_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can insert oauth credentials"
ON public.oauth_credentials
FOR INSERT
WITH CHECK (is_organization_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can update oauth credentials"
ON public.oauth_credentials
FOR UPDATE
USING (is_organization_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can delete oauth credentials"
ON public.oauth_credentials
FOR DELETE
USING (is_organization_admin(auth.uid(), organization_id));

-- Organization members policies
CREATE POLICY "Only owners and admins can manage members"
ON public.organization_members
FOR ALL
USING (is_organization_admin(auth.uid(), organization_id))
WITH CHECK (is_organization_admin(auth.uid(), organization_id));

CREATE POLICY "Users can add themselves as organization members"
ON public.organization_members
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Processed documents policies
CREATE POLICY "Members and above can create documents"
ON public.processed_documents
FOR INSERT
WITH CHECK (can_edit_organization_content(auth.uid(), organization_id));

CREATE POLICY "Members and above can update documents"
ON public.processed_documents
FOR UPDATE
USING (can_edit_organization_content(auth.uid(), organization_id));

CREATE POLICY "Only admins can delete documents"
ON public.processed_documents
FOR DELETE
USING (is_organization_admin(auth.uid(), organization_id));

-- Vendors policies
CREATE POLICY "Admins can insert vendors"
ON public.vendors
FOR INSERT
WITH CHECK (is_organization_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can update vendors"
ON public.vendors
FOR UPDATE
USING (is_organization_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can delete vendors"
ON public.vendors
FOR DELETE
USING (is_organization_admin(auth.uid(), organization_id));

-- System settings policies
CREATE POLICY "Admins can insert settings"
ON public.system_settings
FOR INSERT
WITH CHECK (is_organization_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can update settings"
ON public.system_settings
FOR UPDATE
USING (is_organization_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can delete settings"
ON public.system_settings
FOR DELETE
USING (is_organization_admin(auth.uid(), organization_id));

-- Integration accounts policies
CREATE POLICY "Admins can manage integrations"
ON public.integration_accounts
FOR ALL
USING (is_organization_admin(auth.uid(), organization_id))
WITH CHECK (is_organization_admin(auth.uid(), organization_id));

-- Vendor classification rules policies
CREATE POLICY "Admins can manage classification rules"
ON public.vendor_classification_rules
FOR ALL
USING (is_organization_admin(auth.uid(), organization_id))
WITH CHECK (is_organization_admin(auth.uid(), organization_id));