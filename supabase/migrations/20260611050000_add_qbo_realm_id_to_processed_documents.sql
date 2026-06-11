-- Bind each published document to the QuickBooks company (realm) it was
-- created in. Without this, a document can be marked "published" with a
-- qbo_entity_id that only exists in a realm the org is no longer connected to,
-- which surfaces as "sent to QuickBooks but not there" (orphans).
ALTER TABLE public.processed_documents
  ADD COLUMN IF NOT EXISTS qbo_realm_id TEXT;

-- Helps the audit (audit-qbo-published-vs-actual) quickly find docs published
-- to a realm that differs from the org's currently connected one.
CREATE INDEX IF NOT EXISTS idx_processed_documents_qbo_realm
  ON public.processed_documents (organization_id, qbo_realm_id);
