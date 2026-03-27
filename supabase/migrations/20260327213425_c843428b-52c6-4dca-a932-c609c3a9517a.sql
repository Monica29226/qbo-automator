
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS tipo_persona text NOT NULL DEFAULT 'fisica',
  ADD COLUMN IF NOT EXISTS numero_cedula text,
  ADD COLUMN IF NOT EXISTS nombre_comercial text,
  ADD COLUMN IF NOT EXISTS nombre_representante text,
  ADD COLUMN IF NOT EXISTS cedula_representante text,
  ADD COLUMN IF NOT EXISTS telefono text,
  ADD COLUMN IF NOT EXISTS direccion text,
  ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_numero_cedula ON public.profiles (numero_cedula) WHERE numero_cedula IS NOT NULL;

ALTER TABLE public.sync_logs
  ADD COLUMN IF NOT EXISTS error_detail text,
  ADD COLUMN IF NOT EXISTS error_code text;
