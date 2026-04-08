
UPDATE public.processed_documents 
SET status = 'pending', 
    error_message = NULL, 
    retry_count = 0,
    updated_at = now()
WHERE status = 'error' 
  AND error_message LIKE '%no existe en QuickBooks%'
  AND default_account_ref IS NOT NULL
  AND default_account_ref NOT LIKE '1150040%';
