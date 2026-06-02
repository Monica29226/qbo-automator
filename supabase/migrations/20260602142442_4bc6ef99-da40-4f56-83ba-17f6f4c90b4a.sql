-- Administrative payment tracking on invoices
ALTER TABLE public.processed_documents
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'pending_payment',
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_by uuid,
  ADD COLUMN IF NOT EXISTS payment_proof_url text,
  ADD COLUMN IF NOT EXISTS payment_proof_drive_id text,
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS payment_method text;

ALTER TABLE public.processed_documents
  DROP CONSTRAINT IF EXISTS processed_documents_payment_status_check;
ALTER TABLE public.processed_documents
  ADD CONSTRAINT processed_documents_payment_status_check
  CHECK (payment_status IN ('pending_payment','paid'));

CREATE INDEX IF NOT EXISTS idx_processed_documents_payment_status
  ON public.processed_documents (organization_id, payment_status, issue_date DESC);

-- Storage policies for payment-proofs bucket (bucket itself is created via tool)
-- Members of an organization can read/write proofs in their org folder; admins can delete.
DO $$
BEGIN
  -- SELECT
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='payment_proofs_select_members'
  ) THEN
    CREATE POLICY payment_proofs_select_members ON storage.objects
      FOR SELECT
      USING (
        bucket_id = 'payment-proofs'
        AND public.is_organization_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
      );
  END IF;

  -- INSERT
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='payment_proofs_insert_members'
  ) THEN
    CREATE POLICY payment_proofs_insert_members ON storage.objects
      FOR INSERT
      WITH CHECK (
        bucket_id = 'payment-proofs'
        AND public.can_edit_organization_content(auth.uid(), ((storage.foldername(name))[1])::uuid)
      );
  END IF;

  -- UPDATE
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='payment_proofs_update_members'
  ) THEN
    CREATE POLICY payment_proofs_update_members ON storage.objects
      FOR UPDATE
      USING (
        bucket_id = 'payment-proofs'
        AND public.can_edit_organization_content(auth.uid(), ((storage.foldername(name))[1])::uuid)
      );
  END IF;

  -- DELETE (admin only)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='payment_proofs_delete_admins'
  ) THEN
    CREATE POLICY payment_proofs_delete_admins ON storage.objects
      FOR DELETE
      USING (
        bucket_id = 'payment-proofs'
        AND public.is_organization_admin(auth.uid(), ((storage.foldername(name))[1])::uuid)
      );
  END IF;
END $$;