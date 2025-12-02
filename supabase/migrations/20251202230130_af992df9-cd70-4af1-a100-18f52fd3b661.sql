-- Índices compuestos para mejorar rendimiento de queries frecuentes

-- Índice para queries de dashboard por status y organización
CREATE INDEX IF NOT EXISTS idx_documents_org_status ON public.processed_documents(organization_id, status);

-- Índice para filtros de fecha por organización
CREATE INDEX IF NOT EXISTS idx_documents_org_created ON public.processed_documents(organization_id, created_at DESC);

-- Índice para búsqueda de perfiles por email
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);

-- Índice para user_active_organization por user_id
CREATE INDEX IF NOT EXISTS idx_user_active_org_user ON public.user_active_organization(user_id);

-- Índice para integration_accounts por org y tipo de servicio
CREATE INDEX IF NOT EXISTS idx_integration_accounts_org_service ON public.integration_accounts(organization_id, service_type, is_active);

-- Índice para vendors por organización
CREATE INDEX IF NOT EXISTS idx_vendors_org ON public.vendors(organization_id);

-- Índice para vendor_defaults por organización y nombre
CREATE INDEX IF NOT EXISTS idx_vendor_defaults_org_name ON public.vendor_defaults(organization_id, vendor_name);