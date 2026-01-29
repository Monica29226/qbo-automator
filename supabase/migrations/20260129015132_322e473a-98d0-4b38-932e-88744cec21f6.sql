-- Drop the existing check constraint and add a new one that includes 'hostinger'
ALTER TABLE public.integration_accounts 
DROP CONSTRAINT IF EXISTS integration_accounts_service_type_check;

ALTER TABLE public.integration_accounts 
ADD CONSTRAINT integration_accounts_service_type_check 
CHECK (service_type IN ('gmail', 'outlook', 'quickbooks', 'google_drive', 'bluehost', 'hostinger'));