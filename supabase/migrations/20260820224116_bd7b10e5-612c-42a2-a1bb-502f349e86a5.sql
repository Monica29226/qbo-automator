ALTER FUNCTION public.discard_processed_documents(uuid[], text) SECURITY INVOKER;
REVOKE ALL ON FUNCTION public.block_ignored_document_reimport() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.block_ignored_document_reimport() FROM anon;
REVOKE ALL ON FUNCTION public.block_ignored_document_reimport() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.block_ignored_document_reimport() TO service_role;