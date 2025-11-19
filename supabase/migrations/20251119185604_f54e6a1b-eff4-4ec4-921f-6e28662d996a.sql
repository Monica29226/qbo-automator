-- Add uses_tax column to processed_documents table
ALTER TABLE processed_documents 
ADD COLUMN uses_tax boolean DEFAULT true;

COMMENT ON COLUMN processed_documents.uses_tax IS 'Indica si la factura aplica IVA';