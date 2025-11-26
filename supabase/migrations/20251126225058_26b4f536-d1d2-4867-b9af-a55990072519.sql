-- Agregar columnas para configuración de cuentas por factura individual
ALTER TABLE processed_documents 
ADD COLUMN IF NOT EXISTS default_account_ref TEXT,
ADD COLUMN IF NOT EXISTS default_class_ref TEXT;

-- Índice para búsquedas rápidas por cuenta
CREATE INDEX IF NOT EXISTS idx_processed_documents_account_ref 
ON processed_documents(default_account_ref);

-- Comentarios para documentar las columnas
COMMENT ON COLUMN processed_documents.default_account_ref IS 'Cuenta contable asignada a esta factura específica (formato: CODIGO NOMBRE)';
COMMENT ON COLUMN processed_documents.default_class_ref IS 'Centro de costo o clase asignado a esta factura específica';