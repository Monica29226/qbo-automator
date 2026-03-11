
-- Fix review documents that already have matching vendor_defaults across ALL organizations
UPDATE processed_documents pd
SET status = 'processed',
    default_account_ref = vd.default_account_ref,
    processed_at = NOW(),
    updated_at = NOW()
FROM vendor_defaults vd
WHERE pd.organization_id = vd.organization_id
  AND pd.status = 'review'
  AND pd.qbo_entity_id IS NULL
  AND vd.default_account_ref IS NOT NULL
  AND LOWER(REGEXP_REPLACE(pd.supplier_name, '[^a-zA-Z0-9]', '', 'g')) = LOWER(REGEXP_REPLACE(vd.vendor_name, '[^a-zA-Z0-9]', '', 'g'));
