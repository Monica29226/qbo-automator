-- Eliminar datos existentes de system_settings (son solo defaults)
DELETE FROM public.system_settings;

-- Tabla de organizaciones/empresas
CREATE TABLE IF NOT EXISTS public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  tax_id TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  qbo_company_id TEXT,
  qbo_realm_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  settings JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- Tabla de miembros de organización
CREATE TABLE IF NOT EXISTS public.organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

-- Funciones de verificación
CREATE OR REPLACE FUNCTION public.is_organization_member(_user_id UUID, _org_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE user_id = _user_id
      AND organization_id = _org_id
      AND is_active = true
  )
$$;

CREATE OR REPLACE FUNCTION public.is_organization_admin(_user_id UUID, _org_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE user_id = _user_id
      AND organization_id = _org_id
      AND role IN ('owner', 'admin')
      AND is_active = true
  )
$$;

-- RLS para organizations
DROP POLICY IF EXISTS "Users can view their organizations" ON public.organizations;
CREATE POLICY "Users can view their organizations"
ON public.organizations
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_members.organization_id = organizations.id
      AND organization_members.user_id = auth.uid()
      AND organization_members.is_active = true
  )
);

DROP POLICY IF EXISTS "Organization admins can update" ON public.organizations;
CREATE POLICY "Organization admins can update"
ON public.organizations
FOR UPDATE
TO authenticated
USING (public.is_organization_admin(auth.uid(), id));

-- RLS para organization_members
DROP POLICY IF EXISTS "Users can view members of their organizations" ON public.organization_members;
CREATE POLICY "Users can view members of their organizations"
ON public.organization_members
FOR SELECT
TO authenticated
USING (public.is_organization_member(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Organization admins can manage members" ON public.organization_members;
CREATE POLICY "Organization admins can manage members"
ON public.organization_members
FOR ALL
TO authenticated
USING (public.is_organization_admin(auth.uid(), organization_id));

-- Agregar organization_id a vendors
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;

-- Actualizar RLS de vendors
DROP POLICY IF EXISTS "Authenticated users can view vendors" ON public.vendors;
DROP POLICY IF EXISTS "Admins can manage vendors" ON public.vendors;
DROP POLICY IF EXISTS "Members can view organization vendors" ON public.vendors;
DROP POLICY IF EXISTS "Admins can manage organization vendors" ON public.vendors;

CREATE POLICY "Members can view organization vendors"
ON public.vendors
FOR SELECT
TO authenticated
USING (public.is_organization_member(auth.uid(), organization_id));

CREATE POLICY "Admins can manage organization vendors"
ON public.vendors
FOR ALL
TO authenticated
USING (public.is_organization_admin(auth.uid(), organization_id));

-- Agregar organization_id a processed_documents
ALTER TABLE public.processed_documents ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;

-- Actualizar RLS de processed_documents
DROP POLICY IF EXISTS "Authenticated users can view documents" ON public.processed_documents;
DROP POLICY IF EXISTS "Authenticated users can create documents" ON public.processed_documents;
DROP POLICY IF EXISTS "Admins can manage documents" ON public.processed_documents;
DROP POLICY IF EXISTS "Members can view organization documents" ON public.processed_documents;
DROP POLICY IF EXISTS "Members can create organization documents" ON public.processed_documents;
DROP POLICY IF EXISTS "Admins can manage organization documents" ON public.processed_documents;

CREATE POLICY "Members can view organization documents"
ON public.processed_documents
FOR SELECT
TO authenticated
USING (public.is_organization_member(auth.uid(), organization_id));

CREATE POLICY "Members can create organization documents"
ON public.processed_documents
FOR INSERT
TO authenticated
WITH CHECK (public.is_organization_member(auth.uid(), organization_id));

CREATE POLICY "Admins can manage organization documents"
ON public.processed_documents
FOR ALL
TO authenticated
USING (public.is_organization_admin(auth.uid(), organization_id));

-- Modificar system_settings para multi-tenant
ALTER TABLE public.system_settings DROP CONSTRAINT IF EXISTS system_settings_pkey;
ALTER TABLE public.system_settings ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.system_settings ADD PRIMARY KEY (key, organization_id);

-- Actualizar RLS de system_settings
DROP POLICY IF EXISTS "Authenticated users can view settings" ON public.system_settings;
DROP POLICY IF EXISTS "Admins can manage settings" ON public.system_settings;
DROP POLICY IF EXISTS "Members can view organization settings" ON public.system_settings;
DROP POLICY IF EXISTS "Admins can manage organization settings" ON public.system_settings;

CREATE POLICY "Members can view organization settings"
ON public.system_settings
FOR SELECT
TO authenticated
USING (public.is_organization_member(auth.uid(), organization_id));

CREATE POLICY "Admins can manage organization settings"
ON public.system_settings
FOR ALL
TO authenticated
USING (public.is_organization_admin(auth.uid(), organization_id));

-- Tabla para organización activa del usuario
CREATE TABLE IF NOT EXISTS public.user_active_organization (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_active_organization ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own active organization" ON public.user_active_organization;
CREATE POLICY "Users can manage their own active organization"
ON public.user_active_organization
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Función para obtener organización activa
CREATE OR REPLACE FUNCTION public.get_user_active_organization(_user_id UUID)
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id
  FROM public.user_active_organization
  WHERE user_id = _user_id
$$;

-- Trigger para crear organización al registrar usuario
CREATE OR REPLACE FUNCTION public.handle_new_user_organization()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_org_id UUID;
BEGIN
  -- Crear organización por defecto
  INSERT INTO public.organizations (name, email)
  VALUES (
    COALESCE(NEW.raw_user_meta_data->>'company_name', 'Mi Empresa'),
    NEW.email
  )
  RETURNING id INTO new_org_id;
  
  -- Agregar usuario como owner
  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (new_org_id, NEW.id, 'owner');
  
  -- Establecer como organización activa
  INSERT INTO public.user_active_organization (user_id, organization_id)
  VALUES (NEW.id, new_org_id);
  
  -- Crear settings por defecto
  INSERT INTO public.system_settings (key, value, description, organization_id) VALUES
  ('qbo_company_id', '', 'QuickBooks Company ID (realmId)', new_org_id),
  ('mail_provider', 'gmail', 'Proveedor de correo: gmail u outlook', new_org_id),
  ('mail_query', 'has:attachment (filename:xml OR filename:pdf) newer_than:30d', 'Filtro de búsqueda de correos', new_org_id),
  ('process_credit_notes', 'true', 'Procesar notas de crédito automáticamente', new_org_id),
  ('currency_fallback', 'CRC', 'Moneda por defecto si falta en XML', new_org_id),
  ('duplicate_window_days', '120', 'Ventana anti-duplicados en días', new_org_id),
  ('dry_run', 'true', 'Modo prueba (no publica en QBO)', new_org_id);
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_organization ON auth.users;
CREATE TRIGGER on_auth_user_created_organization
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_organization();

-- Triggers para updated_at
DROP TRIGGER IF EXISTS update_organizations_updated_at ON public.organizations;
CREATE TRIGGER update_organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_organization_members_updated_at ON public.organization_members;
CREATE TRIGGER update_organization_members_updated_at
  BEFORE UPDATE ON public.organization_members
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Índices
CREATE INDEX IF NOT EXISTS idx_organization_members_user_id ON public.organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_organization_members_org_id ON public.organization_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_vendors_org_id ON public.vendors(organization_id);
CREATE INDEX IF NOT EXISTS idx_documents_org_id ON public.processed_documents(organization_id);
CREATE INDEX IF NOT EXISTS idx_settings_org_id ON public.system_settings(organization_id);