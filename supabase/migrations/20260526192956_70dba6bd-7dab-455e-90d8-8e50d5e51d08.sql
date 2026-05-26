
-- Storage bucket (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('invoice-imports', 'invoice-imports', false)
ON CONFLICT (id) DO NOTHING;

-- Bucket RLS: org-scoped via folder name = organization_id
CREATE POLICY "Org admins can read invoice-imports"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'invoice-imports'
  AND public.is_organization_admin(auth.uid(), ((storage.foldername(name))[1])::uuid)
);

CREATE POLICY "Org admins can upload invoice-imports"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'invoice-imports'
  AND public.is_organization_admin(auth.uid(), ((storage.foldername(name))[1])::uuid)
);

CREATE POLICY "Org admins can delete invoice-imports"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'invoice-imports'
  AND public.is_organization_admin(auth.uid(), ((storage.foldername(name))[1])::uuid)
);

-- Batch header
CREATE TABLE public.batch_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  created_by uuid NOT NULL,
  month_filter text,
  status text NOT NULL DEFAULT 'processing',
  total_files integer NOT NULL DEFAULT 0,
  accepted_count integer NOT NULL DEFAULT 0,
  pending_count integer NOT NULL DEFAULT 0,
  rejected_count integer NOT NULL DEFAULT 0,
  duplicate_count integer NOT NULL DEFAULT 0,
  missing_consecutives jsonb NOT NULL DEFAULT '[]'::jsonb,
  notification_sent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.batch_imports TO authenticated;
GRANT ALL ON public.batch_imports TO service_role;

ALTER TABLE public.batch_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view org batch imports" ON public.batch_imports
FOR SELECT TO authenticated
USING (public.is_organization_member(auth.uid(), organization_id));

CREATE POLICY "Admins create batch imports" ON public.batch_imports
FOR INSERT TO authenticated
WITH CHECK (public.is_organization_admin(auth.uid(), organization_id) AND auth.uid() = created_by);

CREATE POLICY "Admins update batch imports" ON public.batch_imports
FOR UPDATE TO authenticated
USING (public.is_organization_admin(auth.uid(), organization_id));

CREATE POLICY "Admins delete batch imports" ON public.batch_imports
FOR DELETE TO authenticated
USING (public.is_organization_admin(auth.uid(), organization_id));

-- Batch items
CREATE TABLE public.batch_import_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.batch_imports(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  filename text NOT NULL,
  doc_key text,
  doc_number text,
  doc_type text,
  supplier_name text,
  supplier_tax_id text,
  receptor_tax_id text,
  issue_date date,
  currency text,
  total_amount numeric,
  total_tax numeric,
  status text NOT NULL,
  reason text,
  hacienda_message_code text,
  xml_storage_path text,
  pdf_storage_path text,
  receptor_xml_storage_path text,
  processed_document_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_batch_items_batch ON public.batch_import_items(batch_id);
CREATE INDEX idx_batch_items_org_key ON public.batch_import_items(organization_id, doc_key);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.batch_import_items TO authenticated;
GRANT ALL ON public.batch_import_items TO service_role;

ALTER TABLE public.batch_import_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view org batch items" ON public.batch_import_items
FOR SELECT TO authenticated
USING (public.is_organization_member(auth.uid(), organization_id));

CREATE POLICY "Admins manage batch items" ON public.batch_import_items
FOR ALL TO authenticated
USING (public.is_organization_admin(auth.uid(), organization_id))
WITH CHECK (public.is_organization_admin(auth.uid(), organization_id));
