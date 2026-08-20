CREATE TABLE public.ignored_documents (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  doc_key text NOT NULL,
  doc_number text,
  issue_date date,
  supplier_name text,
  reason text NOT NULL DEFAULT 'deleted_by_user',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, doc_key)
);

CREATE INDEX idx_ignored_documents_org_key ON public.ignored_documents (organization_id, doc_key);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ignored_documents TO authenticated;
GRANT ALL ON public.ignored_documents TO service_role;

ALTER TABLE public.ignored_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members_select_ignored_documents"
ON public.ignored_documents FOR SELECT TO authenticated
USING (public.is_organization_member(auth.uid(), organization_id));

CREATE POLICY "members_insert_ignored_documents"
ON public.ignored_documents FOR INSERT TO authenticated
WITH CHECK (public.can_edit_organization_content(auth.uid(), organization_id));

CREATE POLICY "members_delete_ignored_documents"
ON public.ignored_documents FOR DELETE TO authenticated
USING (public.can_edit_organization_content(auth.uid(), organization_id));