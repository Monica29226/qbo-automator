UPDATE public.processed_documents pd
SET qbo_realm_id = o.qbo_realm_id
FROM public.organizations o
WHERE o.id = pd.organization_id
  AND pd.qbo_entity_id IS NOT NULL
  AND pd.qbo_realm_id IS NULL
  AND o.qbo_realm_id IS NOT NULL;