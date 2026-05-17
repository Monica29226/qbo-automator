
-- SharePoint admin account (singleton)
CREATE TABLE IF NOT EXISTS public.sharepoint_admin_account (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_email TEXT NOT NULL,
  site_id TEXT,
  site_url TEXT,
  site_name TEXT,
  drive_id TEXT,
  root_folder_id TEXT,
  root_folder_path TEXT NOT NULL DEFAULT 'FacturaFlow',
  credentials JSONB NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.sharepoint_admin_account ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read sharepoint account"
  ON public.sharepoint_admin_account FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins insert sharepoint account"
  ON public.sharepoint_admin_account FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins update sharepoint account"
  ON public.sharepoint_admin_account FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins delete sharepoint account"
  ON public.sharepoint_admin_account FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_sharepoint_admin_updated_at
BEFORE UPDATE ON public.sharepoint_admin_account
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- processed_documents: SharePoint tracking
ALTER TABLE public.processed_documents
  ADD COLUMN IF NOT EXISTS sharepoint_pdf_id TEXT,
  ADD COLUMN IF NOT EXISTS sharepoint_xml_id TEXT,
  ADD COLUMN IF NOT EXISTS sharepoint_uploaded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sharepoint_status TEXT,
  ADD COLUMN IF NOT EXISTS sharepoint_error TEXT,
  ADD COLUMN IF NOT EXISTS sharepoint_retry_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_processed_docs_sharepoint_pending
  ON public.processed_documents (created_at)
  WHERE qbo_entity_id IS NOT NULL AND sharepoint_uploaded_at IS NULL;

-- organizations: per-org SharePoint overrides
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS sharepoint_folder_override TEXT,
  ADD COLUMN IF NOT EXISTS sharepoint_enabled BOOLEAN NOT NULL DEFAULT true;
