-- Drop the existing constraint and add the new one with 'publishing' and 'pending_config' statuses
ALTER TABLE public.processed_documents 
DROP CONSTRAINT IF EXISTS processed_documents_status_check;

ALTER TABLE public.processed_documents 
ADD CONSTRAINT processed_documents_status_check 
CHECK (status = ANY (ARRAY['pending'::text, 'pending_config'::text, 'processed'::text, 'review'::text, 'error'::text, 'duplicate'::text, 'published'::text, 'publishing'::text]));