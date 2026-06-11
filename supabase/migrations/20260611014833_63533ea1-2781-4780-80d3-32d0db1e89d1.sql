CREATE OR REPLACE FUNCTION public.count_published_without_tracking(p_org uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::int
  FROM public.processed_documents pd
  WHERE pd.organization_id = p_org
    AND pd.status = 'published'
    AND pd.qbo_entity_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.qbo_publish_tracking qpt WHERE qpt.document_id = pd.id
    );
$$;

GRANT EXECUTE ON FUNCTION public.count_published_without_tracking(uuid) TO authenticated, service_role;