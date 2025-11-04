-- Tabla para almacenar reglas de clasificación de proveedores
CREATE TABLE IF NOT EXISTS public.vendor_classification_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL,
  vendor_name TEXT NOT NULL,
  account_code TEXT NOT NULL,
  account_description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID,
  
  -- Evitar duplicados para la misma org
  CONSTRAINT unique_vendor_per_org UNIQUE (organization_id, vendor_name)
);

-- Índices para mejorar búsqueda
CREATE INDEX IF NOT EXISTS idx_vendor_classification_org_vendor 
  ON public.vendor_classification_rules(organization_id, vendor_name);

CREATE INDEX IF NOT EXISTS idx_vendor_classification_active 
  ON public.vendor_classification_rules(organization_id, is_active) 
  WHERE is_active = true;

-- Enable RLS
ALTER TABLE public.vendor_classification_rules ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Members can view classification rules"
  ON public.vendor_classification_rules
  FOR SELECT
  USING (is_organization_member(auth.uid(), organization_id));

CREATE POLICY "Admins can manage classification rules"
  ON public.vendor_classification_rules
  FOR ALL
  USING (is_organization_admin(auth.uid(), organization_id));

-- Trigger para updated_at
CREATE TRIGGER update_vendor_classification_rules_updated_at
  BEFORE UPDATE ON public.vendor_classification_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.vendor_classification_rules IS 'Reglas de clasificación de proveedores a cuentas contables de QuickBooks';
COMMENT ON COLUMN public.vendor_classification_rules.vendor_name IS 'Nombre del proveedor tal como aparece en las facturas';
COMMENT ON COLUMN public.vendor_classification_rules.account_code IS 'Código de cuenta contable en QuickBooks (ej: 5105, 6110-03)';
COMMENT ON COLUMN public.vendor_classification_rules.account_description IS 'Descripción de la cuenta (ej: Costo de ventas:Alimentos y Bebidas)';