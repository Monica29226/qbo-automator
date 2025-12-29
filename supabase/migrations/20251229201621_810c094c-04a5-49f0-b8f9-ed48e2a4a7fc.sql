-- Drop the old check constraint and add bluehost to allowed service types
ALTER TABLE public.integration_accounts 
DROP CONSTRAINT integration_accounts_service_type_check;

ALTER TABLE public.integration_accounts 
ADD CONSTRAINT integration_accounts_service_type_check 
CHECK (service_type = ANY (ARRAY['gmail', 'outlook', 'quickbooks', 'google_drive', 'bluehost']));