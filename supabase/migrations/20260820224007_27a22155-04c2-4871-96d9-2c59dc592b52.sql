CREATE OR REPLACE FUNCTION public.discard_processed_documents(
  _document_ids uuid[],
  _reason text DEFAULT 'deleted_by_user'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _deleted_count integer := 0;
  _unauthorized_count integer := 0;
BEGIN
  IF _document_ids IS NULL OR cardinality(_document_ids) = 0 THEN
    RETURN 0;
  END IF;

  SELECT count(*)::integer
  INTO _unauthorized_count
  FROM public.processed_documents pd
  WHERE pd.id = ANY(_document_ids)
    AND NOT (
      public.is_organization_member(auth.uid(), pd.organization_id)
      OR public.has_role(auth.uid(), 'admin')
    );

  IF _unauthorized_count > 0 THEN
    RAISE EXCEPTION 'not authorized to discard one or more documents';
  END IF;

  INSERT INTO public.ignored_documents (
    organization_id,
    doc_key,
    doc_number,
    issue_date,
    supplier_name,
    reason,
    created_by
  )
  SELECT
    pd.organization_id,
    pd.doc_key,
    pd.doc_number,
    pd.issue_date,
    pd.supplier_name,
    COALESCE(NULLIF(trim(_reason), ''), 'deleted_by_user'),
    auth.uid()
  FROM public.processed_documents pd
  WHERE pd.id = ANY(_document_ids)
    AND pd.organization_id IS NOT NULL
    AND pd.doc_key ~ '^[0-9]{50}$'
  ON CONFLICT (organization_id, doc_key)
  DO UPDATE SET
    reason = EXCLUDED.reason,
    doc_number = EXCLUDED.doc_number,
    issue_date = EXCLUDED.issue_date,
    supplier_name = EXCLUDED.supplier_name;

  IF EXISTS (
    SELECT 1
    FROM public.processed_documents pd
    WHERE pd.id = ANY(_document_ids)
      AND (pd.organization_id IS NULL OR pd.doc_key IS NULL OR pd.doc_key !~ '^[0-9]{50}$')
  ) THEN
    RAISE EXCEPTION 'cannot discard a document without a valid 50-digit key';
  END IF;

  DELETE FROM public.processed_documents pd
  WHERE pd.id = ANY(_document_ids);

  GET DIAGNOSTICS _deleted_count = ROW_COUNT;
  RETURN _deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.discard_processed_documents(uuid[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.discard_processed_documents(uuid[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.discard_processed_documents(uuid[], text) TO service_role;

CREATE OR REPLACE FUNCTION public.block_ignored_document_reimport()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.organization_id IS NOT NULL
     AND NEW.doc_key IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.ignored_documents i
       WHERE i.organization_id = NEW.organization_id
         AND i.doc_key = NEW.doc_key
     ) THEN
    RAISE EXCEPTION 'ignored_document: this document was permanently discarded';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_ignored_document_reimport ON public.processed_documents;
CREATE TRIGGER trg_block_ignored_document_reimport
BEFORE INSERT OR UPDATE OF organization_id, doc_key
ON public.processed_documents
FOR EACH ROW
EXECUTE FUNCTION public.block_ignored_document_reimport();