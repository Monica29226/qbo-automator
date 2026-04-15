
-- Bank import configs: per-company bank configuration
CREATE TABLE public.bank_import_configs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bank_name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CRC',
  onedrive_folder_incoming TEXT,
  onedrive_folder_processed TEXT,
  onedrive_folder_error TEXT,
  input_format_type TEXT NOT NULL DEFAULT 'DEBE_HABER',
  date_format TEXT NOT NULL DEFAULT 'dd/MM/yyyy',
  amount_layout TEXT NOT NULL DEFAULT 'DEBIT_CREDIT_COLUMNS',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.bank_import_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view bank import configs" ON public.bank_import_configs
  FOR SELECT USING (is_organization_member(auth.uid(), organization_id));
CREATE POLICY "Admins can insert bank import configs" ON public.bank_import_configs
  FOR INSERT WITH CHECK (is_organization_admin(auth.uid(), organization_id));
CREATE POLICY "Admins can update bank import configs" ON public.bank_import_configs
  FOR UPDATE USING (is_organization_admin(auth.uid(), organization_id));
CREATE POLICY "Admins can delete bank import configs" ON public.bank_import_configs
  FOR DELETE USING (is_organization_admin(auth.uid(), organization_id));

CREATE INDEX idx_bank_import_configs_org ON public.bank_import_configs(organization_id);

-- Bank import sources: parser definitions per bank/file type
CREATE TABLE public.bank_import_sources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bank_import_config_id UUID NOT NULL REFERENCES public.bank_import_configs(id) ON DELETE CASCADE,
  source_name TEXT NOT NULL,
  file_extension TEXT NOT NULL DEFAULT 'csv',
  column_mapping JSONB NOT NULL DEFAULT '{}',
  sample_file_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.bank_import_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view bank import sources" ON public.bank_import_sources
  FOR SELECT USING (is_organization_member(auth.uid(), organization_id));
CREATE POLICY "Admins can insert bank import sources" ON public.bank_import_sources
  FOR INSERT WITH CHECK (is_organization_admin(auth.uid(), organization_id));
CREATE POLICY "Admins can update bank import sources" ON public.bank_import_sources
  FOR UPDATE USING (is_organization_admin(auth.uid(), organization_id));
CREATE POLICY "Admins can delete bank import sources" ON public.bank_import_sources
  FOR DELETE USING (is_organization_admin(auth.uid(), organization_id));

CREATE INDEX idx_bank_import_sources_config ON public.bank_import_sources(bank_import_config_id);
CREATE INDEX idx_bank_import_sources_org ON public.bank_import_sources(organization_id);

-- Bank import jobs: each file processing attempt
CREATE TABLE public.bank_import_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bank_import_config_id UUID NOT NULL REFERENCES public.bank_import_configs(id) ON DELETE CASCADE,
  onedrive_file_id TEXT,
  onedrive_file_name TEXT,
  onedrive_file_path TEXT,
  file_hash TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  error_message TEXT,
  error_details TEXT,
  generated_csv_url TEXT,
  total_rows INTEGER DEFAULT 0,
  valid_rows INTEGER DEFAULT 0,
  invalid_rows INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.bank_import_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view bank import jobs" ON public.bank_import_jobs
  FOR SELECT USING (is_organization_member(auth.uid(), organization_id));
CREATE POLICY "Members can insert bank import jobs" ON public.bank_import_jobs
  FOR INSERT WITH CHECK (can_edit_organization_content(auth.uid(), organization_id));
CREATE POLICY "Members can update bank import jobs" ON public.bank_import_jobs
  FOR UPDATE USING (can_edit_organization_content(auth.uid(), organization_id));
CREATE POLICY "Admins can delete bank import jobs" ON public.bank_import_jobs
  FOR DELETE USING (is_organization_admin(auth.uid(), organization_id));

CREATE INDEX idx_bank_import_jobs_org ON public.bank_import_jobs(organization_id);
CREATE INDEX idx_bank_import_jobs_config ON public.bank_import_jobs(bank_import_config_id);
CREATE INDEX idx_bank_import_jobs_status ON public.bank_import_jobs(status);
CREATE INDEX idx_bank_import_jobs_hash ON public.bank_import_jobs(file_hash);

-- Bank import job items: individual normalized rows
CREATE TABLE public.bank_import_job_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  bank_import_job_id UUID NOT NULL REFERENCES public.bank_import_jobs(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  transaction_date DATE NOT NULL,
  reference TEXT,
  description TEXT,
  money_in NUMERIC DEFAULT 0,
  money_out NUMERIC DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'CRC',
  source_bank TEXT,
  raw_row JSONB,
  status TEXT NOT NULL DEFAULT 'VALID',
  validation_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.bank_import_job_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view bank import job items" ON public.bank_import_job_items
  FOR SELECT USING (is_organization_member(auth.uid(), organization_id));
CREATE POLICY "Members can insert bank import job items" ON public.bank_import_job_items
  FOR INSERT WITH CHECK (can_edit_organization_content(auth.uid(), organization_id));
CREATE POLICY "Members can update bank import job items" ON public.bank_import_job_items
  FOR UPDATE USING (can_edit_organization_content(auth.uid(), organization_id));
CREATE POLICY "Admins can delete bank import job items" ON public.bank_import_job_items
  FOR DELETE USING (is_organization_admin(auth.uid(), organization_id));

CREATE INDEX idx_bank_import_job_items_job ON public.bank_import_job_items(bank_import_job_id);
CREATE INDEX idx_bank_import_job_items_org ON public.bank_import_job_items(organization_id);

-- OneDrive subscriptions: webhook management per company
CREATE TABLE public.onedrive_subscriptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  subscription_id TEXT,
  resource TEXT,
  expiration_datetime TIMESTAMPTZ,
  delta_link TEXT,
  state TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.onedrive_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view onedrive subscriptions" ON public.onedrive_subscriptions
  FOR SELECT USING (is_organization_member(auth.uid(), organization_id));
CREATE POLICY "Admins can insert onedrive subscriptions" ON public.onedrive_subscriptions
  FOR INSERT WITH CHECK (is_organization_admin(auth.uid(), organization_id));
CREATE POLICY "Admins can update onedrive subscriptions" ON public.onedrive_subscriptions
  FOR UPDATE USING (is_organization_admin(auth.uid(), organization_id));
CREATE POLICY "Admins can delete onedrive subscriptions" ON public.onedrive_subscriptions
  FOR DELETE USING (is_organization_admin(auth.uid(), organization_id));

CREATE INDEX idx_onedrive_subscriptions_org ON public.onedrive_subscriptions(organization_id);

-- Triggers for updated_at
CREATE TRIGGER update_bank_import_configs_updated_at BEFORE UPDATE ON public.bank_import_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_bank_import_sources_updated_at BEFORE UPDATE ON public.bank_import_sources
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_bank_import_jobs_updated_at BEFORE UPDATE ON public.bank_import_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_onedrive_subscriptions_updated_at BEFORE UPDATE ON public.onedrive_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
