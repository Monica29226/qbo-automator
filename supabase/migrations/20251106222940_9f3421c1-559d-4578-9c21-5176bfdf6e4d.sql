-- Crear tabla para historial de alertas
CREATE TABLE IF NOT EXISTS public.alert_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('critical', 'warning', 'info')),
  issues_count INTEGER NOT NULL DEFAULT 0,
  issues_data JSONB,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  email_id TEXT,
  acknowledged BOOLEAN DEFAULT FALSE,
  acknowledged_at TIMESTAMP WITH TIME ZONE,
  acknowledged_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX idx_alert_history_org_date ON public.alert_history(organization_id, sent_at DESC);
CREATE INDEX idx_alert_history_acknowledged ON public.alert_history(organization_id, acknowledged) WHERE NOT acknowledged;

-- Enable RLS
ALTER TABLE public.alert_history ENABLE ROW LEVEL SECURITY;

-- Políticas RLS
CREATE POLICY "Members can view organization alerts"
  ON public.alert_history
  FOR SELECT
  USING (is_organization_member(auth.uid(), organization_id));

CREATE POLICY "Members can acknowledge alerts"
  ON public.alert_history
  FOR UPDATE
  USING (is_organization_member(auth.uid(), organization_id));

CREATE POLICY "System can insert alerts"
  ON public.alert_history
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Admins can delete alerts"
  ON public.alert_history
  FOR DELETE
  USING (is_organization_admin(auth.uid(), organization_id));