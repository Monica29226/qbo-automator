CREATE OR REPLACE FUNCTION public.claim_documents_for_qbo_publish(
  _organization_id uuid,
  _document_ids uuid[] DEFAULT NULL,
  _min_issue_date date DEFAULT NULL,
  _limit integer DEFAULT 50
)
RETURNS SETOF public.processed_documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _organization_id IS NULL THEN
    RAISE EXCEPTION 'organization_id is required';
  END IF;

  IF _limit IS NULL OR _limit < 1 OR _limit > 200 THEN
    RAISE EXCEPTION 'limit must be between 1 and 200';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT pd.id
    FROM public.processed_documents pd
    WHERE pd.organization_id = _organization_id
      AND pd.qbo_entity_id IS NULL
      AND pd.status IN ('pending', 'processed')
      AND (_document_ids IS NULL OR pd.id = ANY(_document_ids))
      AND (_document_ids IS NOT NULL OR _min_issue_date IS NULL OR pd.issue_date >= _min_issue_date)
    ORDER BY pd.issue_date ASC, pd.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT _limit
  ), claimed AS (
    UPDATE public.processed_documents pd
    SET status = 'publishing',
        error_message = NULL,
        updated_at = now()
    FROM candidates c
    WHERE pd.id = c.id
      AND pd.status IN ('pending', 'processed')
      AND pd.qbo_entity_id IS NULL
    RETURNING pd.*
  )
  SELECT claimed.* FROM claimed;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_documents_for_qbo_publish(uuid, uuid[], date, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_documents_for_qbo_publish(uuid, uuid[], date, integer) FROM anon;
REVOKE ALL ON FUNCTION public.claim_documents_for_qbo_publish(uuid, uuid[], date, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_documents_for_qbo_publish(uuid, uuid[], date, integer) TO service_role;

COMMENT ON FUNCTION public.claim_documents_for_qbo_publish(uuid, uuid[], date, integer)
IS 'Atomically claims organization-scoped expense documents for the canonical QuickBooks publisher using row locks and SKIP LOCKED.';