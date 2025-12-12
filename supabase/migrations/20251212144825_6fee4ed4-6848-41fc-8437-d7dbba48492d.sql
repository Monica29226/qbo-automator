-- Add email_sender_address setting to existing organizations that don't have it
INSERT INTO public.system_settings (key, value, description, organization_id)
SELECT 
  'email_sender_address',
  'InvoiceFlow <onboarding@resend.dev>',
  'Dirección del remitente para emails de invitación. Formato: Nombre <email@dominio.com>',
  o.id
FROM public.organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_settings ss 
  WHERE ss.organization_id = o.id 
  AND ss.key = 'email_sender_address'
);

-- Update the handle_new_user_organization function to include email_sender_address
CREATE OR REPLACE FUNCTION public.handle_new_user_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  ('dry_run', 'true', 'Modo prueba (no publica en QBO)', new_org_id),
  ('email_sender_address', 'InvoiceFlow <onboarding@resend.dev>', 'Dirección del remitente para emails de invitación', new_org_id);
  
  RETURN NEW;
END;
$function$;