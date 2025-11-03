-- Crear enum para roles de usuarios
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- Tabla de roles de usuarios (seguridad anti-escalación de privilegios)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Función segura para verificar roles (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- RLS: Los usuarios pueden ver sus propios roles
CREATE POLICY "Users can view own roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- RLS: Solo admins pueden insertar roles
CREATE POLICY "Admins can manage roles"
ON public.user_roles
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Tabla de perfiles de usuarios
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- RLS: Los usuarios pueden ver todos los perfiles
CREATE POLICY "Profiles are viewable by authenticated users"
ON public.profiles
FOR SELECT
TO authenticated
USING (true);

-- RLS: Los usuarios solo pueden actualizar su propio perfil
CREATE POLICY "Users can update own profile"
ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = id);

-- Trigger para crear perfil automáticamente
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  );
  
  -- Asignar rol de usuario por defecto
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Tabla de catálogo de proveedores
CREATE TABLE public.vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_name TEXT NOT NULL,
  vendor_tax_id TEXT,
  vendor_email TEXT,
  qbo_vendor_ref TEXT NOT NULL,
  default_account_ref TEXT NOT NULL,
  default_class_ref TEXT,
  default_location_ref TEXT,
  tax_treatment TEXT NOT NULL CHECK (tax_treatment IN ('exento', 'gravado')),
  tax_rate NUMERIC(5,2) NOT NULL CHECK (tax_rate IN (0, 1, 2, 4, 13)),
  discount_account_ref TEXT,
  terms_ref TEXT,
  mapping_hints TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;

-- RLS: Todos los usuarios autenticados pueden ver proveedores
CREATE POLICY "Authenticated users can view vendors"
ON public.vendors
FOR SELECT
TO authenticated
USING (true);

-- RLS: Solo admins pueden gestionar proveedores
CREATE POLICY "Admins can manage vendors"
ON public.vendors
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Tabla de documentos procesados
CREATE TABLE public.processed_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_key TEXT NOT NULL UNIQUE,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('FacturaElectronica', 'NotaCreditoElectronica', 'NotaDebitoElectronica')),
  doc_number TEXT NOT NULL,
  issue_date DATE NOT NULL,
  supplier_name TEXT NOT NULL,
  supplier_tax_id TEXT,
  supplier_email TEXT,
  vendor_id UUID REFERENCES public.vendors(id),
  currency TEXT NOT NULL DEFAULT 'CRC',
  exchange_rate NUMERIC(10,4),
  total_amount NUMERIC(15,2) NOT NULL,
  total_tax NUMERIC(15,2),
  total_discount NUMERIC(15,2),
  qbo_entity_type TEXT CHECK (qbo_entity_type IN ('Bill', 'VendorCredit')),
  qbo_entity_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'review', 'error', 'duplicate')),
  error_message TEXT,
  xml_data JSONB,
  xml_attachment_url TEXT,
  pdf_attachment_url TEXT,
  processed_by UUID REFERENCES auth.users(id),
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.processed_documents ENABLE ROW LEVEL SECURITY;

-- RLS: Todos los usuarios autenticados pueden ver documentos
CREATE POLICY "Authenticated users can view documents"
ON public.processed_documents
FOR SELECT
TO authenticated
USING (true);

-- RLS: Usuarios pueden crear documentos
CREATE POLICY "Authenticated users can create documents"
ON public.processed_documents
FOR INSERT
TO authenticated
WITH CHECK (true);

-- RLS: Solo admins pueden actualizar/eliminar documentos
CREATE POLICY "Admins can manage documents"
ON public.processed_documents
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Índices para mejor rendimiento
CREATE INDEX idx_documents_doc_key ON public.processed_documents(doc_key);
CREATE INDEX idx_documents_status ON public.processed_documents(status);
CREATE INDEX idx_documents_issue_date ON public.processed_documents(issue_date DESC);
CREATE INDEX idx_documents_vendor_id ON public.processed_documents(vendor_id);

-- Tabla de configuración del sistema
CREATE TABLE public.system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- RLS: Todos pueden ver configuración
CREATE POLICY "Authenticated users can view settings"
ON public.system_settings
FOR SELECT
TO authenticated
USING (true);

-- RLS: Solo admins pueden modificar configuración
CREATE POLICY "Admins can manage settings"
ON public.system_settings
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Insertar configuración por defecto
INSERT INTO public.system_settings (key, value, description) VALUES
('qbo_company_id', '', 'QuickBooks Company ID (realmId)'),
('mail_provider', 'gmail', 'Proveedor de correo: gmail u outlook'),
('mail_query', 'has:attachment (filename:xml OR filename:pdf) newer_than:30d', 'Filtro de búsqueda de correos'),
('process_credit_notes', 'true', 'Procesar notas de crédito automáticamente'),
('currency_fallback', 'CRC', 'Moneda por defecto si falta en XML'),
('duplicate_window_days', '120', 'Ventana anti-duplicados en días'),
('dry_run', 'true', 'Modo prueba (no publica en QBO)');

-- Trigger para actualizar updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_vendors_updated_at
  BEFORE UPDATE ON public.vendors
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_documents_updated_at
  BEFORE UPDATE ON public.processed_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();