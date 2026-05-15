-- Allow new statuses on processed_documents
ALTER TABLE public.processed_documents DROP CONSTRAINT IF EXISTS processed_documents_status_check;

ALTER TABLE public.processed_documents
  ADD CONSTRAINT processed_documents_status_check
  CHECK (status = ANY (ARRAY[
    'pending'::text,
    'pending_config'::text,
    'processed'::text,
    'review'::text,
    'error'::text,
    'duplicate'::text,
    'published'::text,
    'publishing'::text,
    'waiting_for_qbo'::text,
    'currency_mismatch'::text
  ]));

-- Reclassify existing currency-related errors
UPDATE public.processed_documents
SET status = 'currency_mismatch', updated_at = NOW()
WHERE status = 'error'
  AND (
    error_message ILIKE '%divisa%'
    OR error_message ILIKE '%currency%'
    OR error_message ILIKE '%code":"6000%'
    OR error_message ILIKE '%cuentas por cobrar y por pagar%'
  );