-- Crear tabla para credenciales OAuth por organización
CREATE TABLE IF NOT EXISTS public.oauth_credentials (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, -- 'google' o 'quickbooks'
  client_id TEXT NOT NULL,
  client_secret TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(organization_id, provider)
);

-- Habilitar RLS
ALTER TABLE public.oauth_credentials ENABLE ROW LEVEL SECURITY;

-- Políticas: solo administradores de la organización pueden ver/editar credenciales
CREATE POLICY "Organization admins can view oauth credentials"
ON public.oauth_credentials
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_members.organization_id = oauth_credentials.organization_id
    AND organization_members.user_id = auth.uid()
    AND organization_members.role IN ('owner', 'admin')
    AND organization_members.is_active = true
  )
);

CREATE POLICY "Organization admins can insert oauth credentials"
ON public.oauth_credentials
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_members.organization_id = oauth_credentials.organization_id
    AND organization_members.user_id = auth.uid()
    AND organization_members.role IN ('owner', 'admin')
    AND organization_members.is_active = true
  )
);

CREATE POLICY "Organization admins can update oauth credentials"
ON public.oauth_credentials
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_members.organization_id = oauth_credentials.organization_id
    AND organization_members.user_id = auth.uid()
    AND organization_members.role IN ('owner', 'admin')
    AND organization_members.is_active = true
  )
);

CREATE POLICY "Organization admins can delete oauth credentials"
ON public.oauth_credentials
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_members.organization_id = oauth_credentials.organization_id
    AND organization_members.user_id = auth.uid()
    AND organization_members.role IN ('owner', 'admin')
    AND organization_members.is_active = true
  )
);

-- Trigger para updated_at
CREATE TRIGGER update_oauth_credentials_updated_at
BEFORE UPDATE ON public.oauth_credentials
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();