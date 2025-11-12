-- Add retry_count column to processed_documents table
ALTER TABLE processed_documents 
ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;

-- Add index for better performance on retry queries
CREATE INDEX IF NOT EXISTS idx_processed_documents_status_retry 
ON processed_documents(status, retry_count) 
WHERE status = 'error';