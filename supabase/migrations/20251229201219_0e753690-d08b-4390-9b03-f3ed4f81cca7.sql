-- Add unique constraint for integration_accounts to allow upsert
ALTER TABLE public.integration_accounts 
ADD CONSTRAINT integration_accounts_org_service_unique 
UNIQUE (organization_id, service_type);