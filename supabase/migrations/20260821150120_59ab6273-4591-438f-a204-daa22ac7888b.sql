ALTER TABLE public.processed_documents ADD COLUMN IF NOT EXISTS qbo_realm_id text;

CREATE INDEX IF NOT EXISTS idx_processed_documents_qbo_realm ON public.processed_documents (organization_id, qbo_realm_id);

-- Repair documents that QuickBooks already has (tracking says published) but whose row
-- never received the entity id because the update column was missing.
UPDATE public.processed_documents pd
SET qbo_entity_id = t.qbo_entity_id,
    qbo_entity_type = COALESCE(t.qbo_entity_type, 'Bill'),
    status = 'published',
    error_message = NULL,
    updated_at = now()
FROM public.qbo_publish_tracking t
WHERE t.document_id = pd.id
  AND t.status = 'published'
  AND t.qbo_entity_id IS NOT NULL
  AND pd.qbo_entity_id IS NULL;