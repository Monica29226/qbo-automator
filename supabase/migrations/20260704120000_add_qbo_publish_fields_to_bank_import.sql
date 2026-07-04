-- Bank statement rows currently stop at "generate CSV for manual upload to
-- QBO Banking". This adds the fields needed to publish each row directly to
-- QuickBooks (Deposit for money_in, Purchase for money_out) via the API,
-- removing the daily manual upload step.

-- Which QBO bank account a given bank config's transactions post to.
-- Kept per-config (not per-organization) because a company can have several
-- bank accounts/banks connected in QBO.
ALTER TABLE public.bank_import_configs
  ADD COLUMN IF NOT EXISTS qbo_bank_account_id TEXT,
  ADD COLUMN IF NOT EXISTS qbo_bank_account_name TEXT;

-- Per-row categorization (the "other side" of the Deposit/Purchase line) and
-- publish tracking, mirroring the invariants already used for
-- processed_documents: "published" implies a real qbo_entity_id, and the
-- realm the row was published to is always recorded.
ALTER TABLE public.bank_import_job_items
  ADD COLUMN IF NOT EXISTS category_account_id TEXT,
  ADD COLUMN IF NOT EXISTS category_account_name TEXT,
  ADD COLUMN IF NOT EXISTS qbo_entity_id TEXT,
  ADD COLUMN IF NOT EXISTS qbo_entity_type TEXT,
  ADD COLUMN IF NOT EXISTS qbo_realm_id TEXT,
  ADD COLUMN IF NOT EXISTS publish_error TEXT,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_bank_import_job_items_qbo_entity
  ON public.bank_import_job_items (qbo_entity_id);
