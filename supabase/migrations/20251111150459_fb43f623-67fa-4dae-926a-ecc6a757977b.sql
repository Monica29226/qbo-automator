-- Agregar constraint único para prevenir duplicados de doc_number por organización
-- Esto evita que se inserten facturas con el mismo número en la misma organización

-- Primero, verificar si hay duplicados existentes y eliminarlos (excepto el primero)
WITH duplicates AS (
  SELECT 
    id,
    ROW_NUMBER() OVER (PARTITION BY doc_number, organization_id ORDER BY created_at ASC) as row_num
  FROM processed_documents
)
DELETE FROM processed_documents
WHERE id IN (
  SELECT id FROM duplicates WHERE row_num > 1
);

-- Ahora agregar el constraint único
ALTER TABLE processed_documents
ADD CONSTRAINT unique_doc_number_per_org UNIQUE (doc_number, organization_id);