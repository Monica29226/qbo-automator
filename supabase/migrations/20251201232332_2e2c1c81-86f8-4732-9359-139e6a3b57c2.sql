-- Create sales_invoices table to store incoming sales/revenue invoices
CREATE TABLE IF NOT EXISTS public.sales_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  
  -- Invoice identification
  doc_key TEXT NOT NULL,
  doc_number TEXT NOT NULL,
  doc_type TEXT NOT NULL DEFAULT 'FE', -- FE, FEC, etc.
  issue_date DATE NOT NULL,
  
  -- Customer information
  customer_name TEXT NOT NULL,
  customer_tax_id TEXT,
  customer_email TEXT,
  
  -- Financial data
  currency TEXT NOT NULL DEFAULT 'CRC',
  exchange_rate NUMERIC,
  subtotal NUMERIC NOT NULL,
  total_tax NUMERIC,
  total_discount NUMERIC,
  total_amount NUMERIC NOT NULL,
  
  -- Classification
  default_income_account_ref TEXT, -- QuickBooks income account ID
  default_class_ref TEXT, -- QuickBooks class/department
  payment_terms_ref TEXT, -- QuickBooks payment terms
  
  -- XML and PDF attachments
  xml_data JSONB,
  xml_attachment_url TEXT,
  pdf_attachment_url TEXT,
  
  -- QuickBooks sync status
  qbo_entity_type TEXT, -- "Invoice", "SalesReceipt"
  qbo_entity_id TEXT, -- QuickBooks Invoice ID
  qbo_customer_ref TEXT, -- QuickBooks Customer ID
  status TEXT NOT NULL DEFAULT 'pending', -- pending, pending_config, published, error
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  
  -- Metadata
  processed_by UUID,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(organization_id, doc_key)
);

-- Create customer_defaults table for customer configuration
CREATE TABLE IF NOT EXISTS public.customer_defaults (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  customer_name TEXT NOT NULL,
  customer_tax_id TEXT,
  
  -- QuickBooks configuration
  qbo_customer_ref TEXT, -- QuickBooks Customer ID
  default_income_account_ref TEXT, -- Default income account (4101 Ventas, etc.)
  default_class_ref TEXT, -- Default department/class
  payment_terms_ref TEXT, -- Default payment terms (Net 30, etc.)
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(organization_id, customer_name)
);

-- Enable RLS on sales_invoices
ALTER TABLE public.sales_invoices ENABLE ROW LEVEL SECURITY;

-- RLS policies for sales_invoices
CREATE POLICY "Members can view organization sales invoices"
  ON public.sales_invoices FOR SELECT
  USING (is_organization_member(auth.uid(), organization_id));

CREATE POLICY "Members can create sales invoices"
  ON public.sales_invoices FOR INSERT
  WITH CHECK (can_edit_organization_content(auth.uid(), organization_id));

CREATE POLICY "Members can update sales invoices"
  ON public.sales_invoices FOR UPDATE
  USING (can_edit_organization_content(auth.uid(), organization_id));

CREATE POLICY "Admins can delete sales invoices"
  ON public.sales_invoices FOR DELETE
  USING (is_organization_admin(auth.uid(), organization_id));

-- Enable RLS on customer_defaults
ALTER TABLE public.customer_defaults ENABLE ROW LEVEL SECURITY;

-- RLS policies for customer_defaults
CREATE POLICY "Members can view customer defaults"
  ON public.customer_defaults FOR SELECT
  USING (is_organization_member(auth.uid(), organization_id));

CREATE POLICY "Members can create customer defaults"
  ON public.customer_defaults FOR INSERT
  WITH CHECK (can_edit_organization_content(auth.uid(), organization_id));

CREATE POLICY "Members can update customer defaults"
  ON public.customer_defaults FOR UPDATE
  USING (can_edit_organization_content(auth.uid(), organization_id));

CREATE POLICY "Admins can delete customer defaults"
  ON public.customer_defaults FOR DELETE
  USING (is_organization_admin(auth.uid(), organization_id));

-- Create indexes for performance
CREATE INDEX idx_sales_invoices_org_status ON public.sales_invoices(organization_id, status);
CREATE INDEX idx_sales_invoices_customer ON public.sales_invoices(organization_id, customer_name);
CREATE INDEX idx_sales_invoices_qbo_id ON public.sales_invoices(qbo_entity_id);
CREATE INDEX idx_customer_defaults_org_name ON public.customer_defaults(organization_id, customer_name);

-- Add trigger for updated_at
CREATE TRIGGER update_sales_invoices_updated_at
  BEFORE UPDATE ON public.sales_invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_customer_defaults_updated_at
  BEFORE UPDATE ON public.customer_defaults
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();