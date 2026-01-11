-- =============================================================
-- QBO PUBLISH TRACKING: Prevent duplicate invoices in QuickBooks
-- =============================================================

-- Create table to track all documents published to QuickBooks
-- This is the PRIMARY control layer to prevent duplicates
CREATE TABLE IF NOT EXISTS public.qbo_publish_tracking (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  
  -- Unique key components from XML (Costa Rica electronic invoice)
  clave_hacienda TEXT NOT NULL,           -- 50-char Hacienda key (unique per invoice)
  doc_number TEXT NOT NULL,               -- Invoice number (e.g., "00100001010000000001")
  emisor_identificacion TEXT,             -- Emitter tax ID
  receptor_identificacion TEXT,           -- Receiver tax ID (our company)
  
  -- QuickBooks entity info (filled after successful publish)
  qbo_entity_id TEXT,
  qbo_entity_type TEXT,                   -- 'Bill', 'VendorCredit', 'Invoice'
  qbo_doc_number TEXT,                    -- DocNumber used in QBO (may be truncated)
  
  -- Tracking info
  document_id UUID REFERENCES public.processed_documents(id) ON DELETE SET NULL,
  published_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Additional metadata for debugging
  total_amount NUMERIC,
  currency TEXT DEFAULT 'CRC',
  supplier_name TEXT,
  
  -- Status of this tracking record
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'published', 'duplicate_blocked', 'error'
  error_message TEXT,
  
  -- UNIQUE constraint to prevent duplicates
  CONSTRAINT unique_invoice_key UNIQUE (organization_id, clave_hacienda)
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_qbo_publish_tracking_clave 
ON public.qbo_publish_tracking(organization_id, clave_hacienda);

CREATE INDEX IF NOT EXISTS idx_qbo_publish_tracking_doc_number 
ON public.qbo_publish_tracking(organization_id, doc_number);

CREATE INDEX IF NOT EXISTS idx_qbo_publish_tracking_qbo_entity 
ON public.qbo_publish_tracking(organization_id, qbo_entity_id) WHERE qbo_entity_id IS NOT NULL;

-- Enable RLS
ALTER TABLE public.qbo_publish_tracking ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Members can view organization tracking" 
ON public.qbo_publish_tracking 
FOR SELECT 
USING (is_organization_member(auth.uid(), organization_id));

CREATE POLICY "Members can insert tracking records" 
ON public.qbo_publish_tracking 
FOR INSERT 
WITH CHECK (can_edit_organization_content(auth.uid(), organization_id));

CREATE POLICY "Members can update tracking records" 
ON public.qbo_publish_tracking 
FOR UPDATE 
USING (can_edit_organization_content(auth.uid(), organization_id));

CREATE POLICY "Admins can delete tracking records" 
ON public.qbo_publish_tracking 
FOR DELETE 
USING (is_organization_admin(auth.uid(), organization_id));

-- Update trigger
CREATE TRIGGER update_qbo_publish_tracking_updated_at
  BEFORE UPDATE ON public.qbo_publish_tracking
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Comment
COMMENT ON TABLE public.qbo_publish_tracking IS 'Primary duplicate prevention layer for QuickBooks publishing. Uses clave_hacienda as unique key per organization.';
