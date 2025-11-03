-- Add integration credentials to organizations table
ALTER TABLE public.organizations 
ADD COLUMN IF NOT EXISTS gmail_connected BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS gmail_email TEXT,
ADD COLUMN IF NOT EXISTS quickbooks_connected BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS quickbooks_realm_id TEXT,
ADD COLUMN IF NOT EXISTS google_drive_connected BOOLEAN DEFAULT false;

-- Create table for storing multiple service accounts per organization
CREATE TABLE IF NOT EXISTS public.integration_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  service_type TEXT NOT NULL CHECK (service_type IN ('gmail', 'quickbooks', 'google_drive')),
  account_email TEXT,
  account_name TEXT,
  is_active BOOLEAN DEFAULT true,
  credentials JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  UNIQUE(organization_id, service_type, account_email)
);

-- Enable RLS
ALTER TABLE public.integration_accounts ENABLE ROW LEVEL SECURITY;

-- RLS Policies for integration_accounts
CREATE POLICY "Organization admins can manage integration accounts"
  ON public.integration_accounts
  FOR ALL
  USING (is_organization_admin(auth.uid(), organization_id));

CREATE POLICY "Organization members can view integration accounts"
  ON public.integration_accounts
  FOR SELECT
  USING (is_organization_member(auth.uid(), organization_id));

-- Trigger for updated_at
CREATE TRIGGER update_integration_accounts_updated_at
  BEFORE UPDATE ON public.integration_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.integration_accounts IS 'Almacena múltiples cuentas de integración por organización';
COMMENT ON COLUMN public.integration_accounts.service_type IS 'Tipo de servicio: gmail, quickbooks, google_drive';
COMMENT ON COLUMN public.integration_accounts.credentials IS 'Credenciales encriptadas del servicio (tokens, etc.)';
