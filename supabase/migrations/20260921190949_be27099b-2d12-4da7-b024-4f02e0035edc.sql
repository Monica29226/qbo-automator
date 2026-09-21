-- 1. Motivo de fallo de envío de correo de alerta
ALTER TABLE public.alert_history ADD COLUMN IF NOT EXISTS email_error text;

-- 2. Cerrar avisos duplicados abiertos: conservar solo el más reciente por (empresa, código)
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY organization_id,
                        coalesce(issues_data->0->>'code', issues_data->>'code', 'sin_codigo')
           ORDER BY sent_at DESC NULLS LAST, created_at DESC
         ) AS rn
  FROM public.alert_history
  WHERE resolved = false
)
UPDATE public.alert_history a
SET resolved = true, resolved_at = now()
FROM ranked r
WHERE a.id = r.id AND r.rn > 1;

-- 3. Índice de apoyo para la deduplicación por código
CREATE INDEX IF NOT EXISTS idx_alert_history_open_by_code
  ON public.alert_history (organization_id, (issues_data->0->>'code'))
  WHERE resolved = false;

-- 4. Destinatarios de avisos: incluir monica@aclcostarica.com en todas las empresas activas
INSERT INTO public.system_settings (organization_id, key, value)
SELECT o.id, 'alert_email', 'monica@aclcostarica.com'
FROM public.organizations o
WHERE o.is_active
ON CONFLICT (key, organization_id) DO UPDATE
SET value = CASE
  WHEN system_settings.value IS NULL OR btrim(system_settings.value) = '' THEN 'monica@aclcostarica.com'
  WHEN position('monica@aclcostarica.com' in lower(system_settings.value)) > 0 THEN system_settings.value
  ELSE system_settings.value || ',monica@aclcostarica.com'
END;

INSERT INTO public.system_settings (organization_id, key, value)
SELECT o.id, 'alert_enabled', 'true'
FROM public.organizations o
WHERE o.is_active
ON CONFLICT (key, organization_id) DO NOTHING;