-- Create vendor_defaults table
CREATE TABLE vendor_defaults (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vendor_name text NOT NULL,
  default_account_ref text,
  default_uses_tax boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  UNIQUE(organization_id, vendor_name)
);

-- Add index for faster lookups
CREATE INDEX idx_vendor_defaults_org_vendor ON vendor_defaults(organization_id, vendor_name);

-- Enable RLS
ALTER TABLE vendor_defaults ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Members can view organization vendor defaults"
  ON vendor_defaults FOR SELECT
  USING (is_organization_member(auth.uid(), organization_id));

CREATE POLICY "Members can insert vendor defaults"
  ON vendor_defaults FOR INSERT
  WITH CHECK (can_edit_organization_content(auth.uid(), organization_id));

CREATE POLICY "Members can update vendor defaults"
  ON vendor_defaults FOR UPDATE
  USING (can_edit_organization_content(auth.uid(), organization_id));

CREATE POLICY "Admins can delete vendor defaults"
  ON vendor_defaults FOR DELETE
  USING (is_organization_admin(auth.uid(), organization_id));

-- Add trigger for updated_at
CREATE TRIGGER update_vendor_defaults_updated_at
  BEFORE UPDATE ON vendor_defaults
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Comment
COMMENT ON TABLE vendor_defaults IS 'Stores default accounting configurations per vendor name';