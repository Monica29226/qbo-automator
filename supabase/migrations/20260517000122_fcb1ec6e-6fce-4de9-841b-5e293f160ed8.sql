
CREATE TABLE IF NOT EXISTS public.legacy_account_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  legacy_account_code TEXT NOT NULL,
  qbo_account_id TEXT,
  qbo_account_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, legacy_account_code)
);

ALTER TABLE public.legacy_account_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view legacy account mappings" ON public.legacy_account_mapping FOR SELECT USING (is_organization_member(auth.uid(), organization_id));
CREATE POLICY "Admins insert legacy account mappings" ON public.legacy_account_mapping FOR INSERT WITH CHECK (is_organization_admin(auth.uid(), organization_id));
CREATE POLICY "Admins update legacy account mappings" ON public.legacy_account_mapping FOR UPDATE USING (is_organization_admin(auth.uid(), organization_id));
CREATE POLICY "Admins delete legacy account mappings" ON public.legacy_account_mapping FOR DELETE USING (is_organization_admin(auth.uid(), organization_id));

CREATE TRIGGER update_legacy_account_mapping_updated_at
  BEFORE UPDATE ON public.legacy_account_mapping
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.processed_documents DROP CONSTRAINT IF EXISTS processed_documents_status_check;
ALTER TABLE public.processed_documents
  ADD CONSTRAINT processed_documents_status_check
  CHECK (status IN (
    'pending','processing','processed','published','error','review',
    'pending_config','waiting_for_qbo','currency_mismatch','needs_account_mapping',
    'publishing','duplicate'
  ));

UPDATE public.processed_documents
SET status = 'waiting_for_qbo', updated_at = NOW()
WHERE status = 'error'
  AND (
    error_message ILIKE '%Estado de la empresa no v%lido%'
    OR error_message ILIKE '%estado de la empresa%'
    OR error_message ILIKE '%per%odo%cerrado%'
    OR error_message ILIKE '%closed period%'
    OR error_message ILIKE '%subscription%'
    OR error_message ILIKE '%suspended%'
    OR error_message ILIKE '%suspendid%'
    OR error_message ILIKE '%cannot find user%'
    OR error_message ILIKE '%ApplicationAuthenticationFailed%'
  );

UPDATE public.alert_history
SET issues_data = jsonb_build_array(jsonb_build_object(
  'type', alert_type,
  'title', COALESCE(CASE WHEN jsonb_typeof(issues_data) = 'array' THEN issues_data->0->>'title' ELSE issues_data->>'title' END, 'Alerta'),
  'description', COALESCE(CASE WHEN jsonb_typeof(issues_data) = 'array' THEN issues_data->0->>'description' ELSE issues_data->>'description' END, ''),
  'code', COALESCE(CASE WHEN jsonb_typeof(issues_data) = 'array' THEN issues_data->0->>'code' ELSE issues_data->>'code' END, alert_type || '_legacy'),
  'actionRequired', COALESCE(CASE WHEN jsonb_typeof(issues_data) = 'array' THEN issues_data->0->>'actionRequired' ELSE issues_data->>'actionRequired' END, '')
))
WHERE issues_data IS NULL
   OR jsonb_typeof(issues_data) NOT IN ('array','object')
   OR (jsonb_typeof(issues_data) = 'array' AND (issues_data->0->>'code') IS NULL)
   OR (jsonb_typeof(issues_data) = 'object' AND (issues_data->>'code') IS NULL);

WITH ranked AS (
  SELECT id,
    row_number() OVER (PARTITION BY organization_id, (issues_data->0->>'code') ORDER BY created_at DESC) AS rn
  FROM public.alert_history WHERE resolved = false
)
UPDATE public.alert_history ah
SET resolved = true, resolved_at = NOW()
FROM ranked
WHERE ah.id = ranked.id AND ranked.rn > 1;
