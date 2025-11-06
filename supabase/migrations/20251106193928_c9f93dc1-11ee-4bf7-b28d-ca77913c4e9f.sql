-- Create organization invitations table
CREATE TABLE public.organization_invitations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  invited_by UUID NOT NULL REFERENCES auth.users(id),
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  accepted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.organization_invitations ENABLE ROW LEVEL SECURITY;

-- Admins can view invitations for their organizations
CREATE POLICY "Admins can view organization invitations"
ON public.organization_invitations
FOR SELECT
USING (is_organization_admin(auth.uid(), organization_id));

-- Admins can create invitations
CREATE POLICY "Admins can create invitations"
ON public.organization_invitations
FOR INSERT
WITH CHECK (is_organization_admin(auth.uid(), organization_id));

-- Admins can delete invitations
CREATE POLICY "Admins can delete invitations"
ON public.organization_invitations
FOR DELETE
USING (is_organization_admin(auth.uid(), organization_id));

-- Anyone can view their own invitations by email
CREATE POLICY "Users can view invitations sent to their email"
ON public.organization_invitations
FOR SELECT
USING (email = auth.jwt()->>'email');

-- Anyone can accept their own invitations
CREATE POLICY "Users can accept their own invitations"
ON public.organization_invitations
FOR UPDATE
USING (email = auth.jwt()->>'email');

-- Create index for faster lookups
CREATE INDEX idx_organization_invitations_email ON public.organization_invitations(email);
CREATE INDEX idx_organization_invitations_token ON public.organization_invitations(token);
CREATE INDEX idx_organization_invitations_expires_at ON public.organization_invitations(expires_at);