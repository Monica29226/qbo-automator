-- Habilitar realtime para la tabla processed_documents
ALTER TABLE public.processed_documents REPLICA IDENTITY FULL;

-- Agregar la tabla al sistema de publicación realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.processed_documents;

COMMENT ON TABLE public.processed_documents IS 
'Tabla habilitada para actualizaciones en tiempo real - el dashboard se actualiza automáticamente cuando se procesan nuevos documentos';