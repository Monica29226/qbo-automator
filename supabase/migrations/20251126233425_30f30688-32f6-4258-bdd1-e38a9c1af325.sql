-- Permitir TiqueteElectronico en processed_documents
-- Los tiquetes electrónicos son documentos válidos de Hacienda que deben procesarse

-- Eliminar el constraint actual
ALTER TABLE processed_documents 
DROP CONSTRAINT IF EXISTS processed_documents_doc_type_check;

-- Crear nuevo constraint incluyendo TiqueteElectronico
ALTER TABLE processed_documents 
ADD CONSTRAINT processed_documents_doc_type_check 
CHECK (doc_type IN (
  'FacturaElectronica',
  'TiqueteElectronico',
  'NotaCreditoElectronica',
  'NotaDebitoElectronica'
));