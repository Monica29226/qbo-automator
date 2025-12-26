-- =====================================================
-- MIGRACIÓN: Cumplimiento Ley 9635 - Costa Rica
-- Campos obligatorios para factura electrónica
-- =====================================================

-- 1. Agregar columnas a la tabla organizations
ALTER TABLE public.organizations 
ADD COLUMN IF NOT EXISTS identification_type text CHECK (identification_type IN ('fisica', 'juridica', 'nite', 'dimex')),
ADD COLUMN IF NOT EXISTS identification_number text,
ADD COLUMN IF NOT EXISTS trade_name text,
ADD COLUMN IF NOT EXISTS legal_name text,
ADD COLUMN IF NOT EXISTS tax_regime text CHECK (tax_regime IN ('general', 'simplificado', 'agropecuario')),
ADD COLUMN IF NOT EXISTS main_economic_activity text,
ADD COLUMN IF NOT EXISTS economic_activity_code text,
ADD COLUMN IF NOT EXISTS hacienda_notification_email text,
ADD COLUMN IF NOT EXISTS province text,
ADD COLUMN IF NOT EXISTS canton text,
ADD COLUMN IF NOT EXISTS district text,
ADD COLUMN IF NOT EXISTS exact_address text;

-- 2. Crear tabla para items CAByS (Catálogo de Bienes y Servicios)
CREATE TABLE IF NOT EXISTS public.cabys_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  cabys_code text NOT NULL,
  name text NOT NULL,
  description text,
  unit text DEFAULT 'Unid',
  is_service boolean DEFAULT false,
  default_price numeric,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE(organization_id, cabys_code)
);

-- 3. Crear tabla para certificados de Hacienda (firma digital)
CREATE TABLE IF NOT EXISTS public.hacienda_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE UNIQUE,
  certificate_name text NOT NULL,
  certificate_storage_path text,
  pin_hash text,
  expires_at timestamp with time zone,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by uuid
);

-- 4. Crear tabla para consecutivos de facturación
CREATE TABLE IF NOT EXISTS public.billing_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  doc_type text NOT NULL CHECK (doc_type IN ('FE', 'NC', 'ND', 'TE', 'FEE', 'CCE')),
  branch_code text DEFAULT '001',
  terminal_code text DEFAULT '00001',
  next_number bigint DEFAULT 1,
  prefix text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(organization_id, doc_type, branch_code, terminal_code)
);

-- 5. Habilitar RLS en las nuevas tablas
ALTER TABLE public.cabys_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hacienda_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_sequences ENABLE ROW LEVEL SECURITY;

-- 6. Políticas RLS para cabys_items
CREATE POLICY "Members can view organization cabys items"
  ON public.cabys_items FOR SELECT
  USING (is_organization_member(auth.uid(), organization_id));

CREATE POLICY "Admins can insert cabys items"
  ON public.cabys_items FOR INSERT
  WITH CHECK (is_organization_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can update cabys items"
  ON public.cabys_items FOR UPDATE
  USING (is_organization_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can delete cabys items"
  ON public.cabys_items FOR DELETE
  USING (is_organization_admin(auth.uid(), organization_id));

-- 7. Políticas RLS para hacienda_certificates
CREATE POLICY "Admins can view organization certificates"
  ON public.hacienda_certificates FOR SELECT
  USING (is_organization_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can insert certificates"
  ON public.hacienda_certificates FOR INSERT
  WITH CHECK (is_organization_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can update certificates"
  ON public.hacienda_certificates FOR UPDATE
  USING (is_organization_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can delete certificates"
  ON public.hacienda_certificates FOR DELETE
  USING (is_organization_admin(auth.uid(), organization_id));

-- 8. Políticas RLS para billing_sequences
CREATE POLICY "Members can view organization sequences"
  ON public.billing_sequences FOR SELECT
  USING (is_organization_member(auth.uid(), organization_id));

CREATE POLICY "Admins can insert sequences"
  ON public.billing_sequences FOR INSERT
  WITH CHECK (is_organization_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can update sequences"
  ON public.billing_sequences FOR UPDATE
  USING (is_organization_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can delete sequences"
  ON public.billing_sequences FOR DELETE
  USING (is_organization_admin(auth.uid(), organization_id));

-- 9. Triggers para updated_at
CREATE TRIGGER update_cabys_items_updated_at
  BEFORE UPDATE ON public.cabys_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_hacienda_certificates_updated_at
  BEFORE UPDATE ON public.hacienda_certificates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_billing_sequences_updated_at
  BEFORE UPDATE ON public.billing_sequences
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();