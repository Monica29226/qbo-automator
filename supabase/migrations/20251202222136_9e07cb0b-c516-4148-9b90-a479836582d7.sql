-- Add bluehost connection fields to organizations
ALTER TABLE public.organizations 
ADD COLUMN IF NOT EXISTS bluehost_connected boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS bluehost_email text;