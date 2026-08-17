ALTER TABLE public.integration_accounts
ADD COLUMN IF NOT EXISTS sync_from TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.integration_accounts.sync_from IS
  'Fecha/hora a partir de la cual se debe importar correos. Se establece al conectar/reconectar para evitar cargar histórico anterior.';

UPDATE public.integration_accounts
SET sync_from = now(), updated_at = now()
WHERE organization_id = '930d6cce-bcaa-4992-ad7f-1e29df1ab6e9'
  AND service_type = 'gmail'
  AND account_email = 'administrativo@gruposkr.com';