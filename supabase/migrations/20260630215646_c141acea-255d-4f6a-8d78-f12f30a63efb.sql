ALTER TABLE public.integration_accounts DROP CONSTRAINT IF EXISTS integration_accounts_service_type_check;
ALTER TABLE public.integration_accounts ADD CONSTRAINT integration_accounts_service_type_check CHECK (service_type = ANY (ARRAY['gmail','outlook','outlook_imap','quickbooks','google_drive','bluehost','hostinger','siku']));

INSERT INTO public.integration_accounts (organization_id, service_type, is_active, credentials)
VALUES
  ('fce6045d-0bb8-4648-ae5d-f502085314c9','siku',true,'{"company_guid":"0c1cddb9-f520-4bf9-be8c-cecb0e99947c","client_id":"sikumed-public-api","client_secret":"H9F3J2LK8VQW1X7Z5T4M0RP6YDNCBES","ocp_apim_key":"d90804a7118c4a29b06a318272aee41a","tenant_id":"BF239AFA-9E9D-44E4-AF90-F9E529189395"}'::jsonb),
  ('4ff74a44-839d-43d9-a91e-9aa854619243','siku',true,'{"company_guid":"129ac301-7036-413b-9453-b62be6c4d989","client_id":"sikumed-public-api","client_secret":"H9F3J2LK8VQW1X7Z5T4M0RP6YDNCBES","ocp_apim_key":"d90804a7118c4a29b06a318272aee41a","tenant_id":"BF239AFA-9E9D-44E4-AF90-F9E529189395"}'::jsonb),
  ('e34be1a0-6f37-46b8-acf7-8f9b3c6fdc89','siku',true,'{"company_guid":"6b3c1404-af73-4351-bac4-39107e5ab0fc","client_id":"sikumed-public-api","client_secret":"H9F3J2LK8VQW1X7Z5T4M0RP6YDNCBES","ocp_apim_key":"d90804a7118c4a29b06a318272aee41a","tenant_id":"BF239AFA-9E9D-44E4-AF90-F9E529189395"}'::jsonb)
ON CONFLICT DO NOTHING;