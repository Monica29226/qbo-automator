-- Update integration_accounts to support outlook
ALTER TABLE public.integration_accounts 
DROP CONSTRAINT IF EXISTS integration_accounts_service_type_check;

ALTER TABLE public.integration_accounts
ADD CONSTRAINT integration_accounts_service_type_check 
CHECK (service_type IN ('gmail', 'outlook', 'quickbooks', 'google_drive'));

-- Add outlook connection fields to organizations
ALTER TABLE public.organizations 
ADD COLUMN IF NOT EXISTS outlook_connected BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS outlook_email TEXT;

COMMENT ON COLUMN public.organizations.outlook_connected IS 'Indica si Outlook está conectado';
COMMENT ON COLUMN public.organizations.outlook_email IS 'Email de la cuenta de Outlook conectada';
