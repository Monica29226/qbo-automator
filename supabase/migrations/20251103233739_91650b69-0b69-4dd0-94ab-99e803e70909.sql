-- Add Google Drive configuration fields to organizations table
ALTER TABLE public.organizations 
ADD COLUMN IF NOT EXISTS google_drive_folder_id TEXT,
ADD COLUMN IF NOT EXISTS google_drive_enabled BOOLEAN DEFAULT false;

COMMENT ON COLUMN public.organizations.google_drive_folder_id IS 'ID de la carpeta de Google Drive para almacenar documentos';
COMMENT ON COLUMN public.organizations.google_drive_enabled IS 'Indica si la sincronización con Google Drive está activa';
