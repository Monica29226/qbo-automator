-- Eliminar el constraint único por doc_number+org que causa conflictos
-- La clave única correcta es doc_key (clave electrónica de 50 dígitos)
ALTER TABLE processed_documents DROP CONSTRAINT IF EXISTS unique_doc_number_per_org;