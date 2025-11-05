
-- Crear tabla para logs de sincronización automática
CREATE TABLE IF NOT EXISTS public.sync_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  trigger_type TEXT NOT NULL, -- 'cron', 'manual', 'button'
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE,
  status TEXT NOT NULL DEFAULT 'running', -- 'running', 'success', 'error'
  gmail_fetched INTEGER DEFAULT 0,
  gmail_processed INTEGER DEFAULT 0,
  gmail_failed INTEGER DEFAULT 0,
  qbo_published INTEGER DEFAULT 0,
  qbo_failed INTEGER DEFAULT 0,
  error_message TEXT,
  execution_time_ms INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Habilitar RLS
ALTER TABLE public.sync_logs ENABLE ROW LEVEL SECURITY;

-- Políticas RLS
CREATE POLICY "Members can view organization sync logs"
  ON public.sync_logs
  FOR SELECT
  USING (is_organization_member(auth.uid(), organization_id));

CREATE POLICY "System can insert sync logs"
  ON public.sync_logs
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "System can update sync logs"
  ON public.sync_logs
  FOR UPDATE
  USING (true);

-- Índices para mejor performance
CREATE INDEX idx_sync_logs_org_id ON public.sync_logs(organization_id);
CREATE INDEX idx_sync_logs_started_at ON public.sync_logs(started_at DESC);
CREATE INDEX idx_sync_logs_status ON public.sync_logs(status);

-- Comentarios
COMMENT ON TABLE public.sync_logs IS 'Logs de ejecución de sincronización automática';
COMMENT ON COLUMN public.sync_logs.trigger_type IS 'Tipo de ejecución: cron (automático), manual (usuario), button (botón)';
COMMENT ON COLUMN public.sync_logs.execution_time_ms IS 'Tiempo de ejecución en milisegundos';
