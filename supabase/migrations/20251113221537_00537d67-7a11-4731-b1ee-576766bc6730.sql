-- Actualizar el constraint de status en processed_documents para incluir 'published'
ALTER TABLE processed_documents 
DROP CONSTRAINT IF EXISTS processed_documents_status_check;

ALTER TABLE processed_documents 
ADD CONSTRAINT processed_documents_status_check 
CHECK (status = ANY (ARRAY['pending'::text, 'processed'::text, 'review'::text, 'error'::text, 'duplicate'::text, 'published'::text]));