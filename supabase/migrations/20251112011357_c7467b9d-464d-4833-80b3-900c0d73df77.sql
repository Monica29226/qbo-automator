-- Create vendor_categories table if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'vendor_categories') THEN
    CREATE TABLE public.vendor_categories (
      id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
      organization_id UUID NOT NULL,
      vendor_identification TEXT NOT NULL,
      vendor_name TEXT NOT NULL,
      account_code TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    );
  END IF;
END $$;

-- Add unique constraint if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'unique_vendor_per_org_v2'
  ) THEN
    ALTER TABLE public.vendor_categories 
    ADD CONSTRAINT unique_vendor_per_org_v2 UNIQUE (organization_id, vendor_identification);
  END IF;
END $$;

-- Enable RLS
ALTER TABLE public.vendor_categories ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist and recreate
DROP POLICY IF EXISTS "Users can view their organization's vendor categories" ON public.vendor_categories;
DROP POLICY IF EXISTS "Users can insert vendor categories for their organization" ON public.vendor_categories;
DROP POLICY IF EXISTS "Users can update their organization's vendor categories" ON public.vendor_categories;
DROP POLICY IF EXISTS "Users can delete their organization's vendor categories" ON public.vendor_categories;

-- Create policies
CREATE POLICY "Users can view their organization's vendor categories"
  ON public.vendor_categories
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM public.organization_members 
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "Users can insert vendor categories for their organization"
  ON public.vendor_categories
  FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id 
      FROM public.organization_members 
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "Users can update their organization's vendor categories"
  ON public.vendor_categories
  FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM public.organization_members 
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "Users can delete their organization's vendor categories"
  ON public.vendor_categories
  FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM public.organization_members 
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

-- Create trigger for updated_at if it doesn't exist
DROP TRIGGER IF EXISTS update_vendor_categories_updated_at ON public.vendor_categories;
CREATE TRIGGER update_vendor_categories_updated_at
  BEFORE UPDATE ON public.vendor_categories
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for faster lookups if it doesn't exist
DROP INDEX IF EXISTS idx_vendor_categories_org_identification;
CREATE INDEX idx_vendor_categories_org_identification 
  ON public.vendor_categories(organization_id, vendor_identification) 
  WHERE is_active = true;