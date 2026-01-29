-- Add Hostinger integration fields to organizations table
ALTER TABLE public.organizations 
ADD COLUMN IF NOT EXISTS hostinger_connected boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS hostinger_email text;