
-- Drop weaker duplicate INSERT policy on company-documents (the active-member version remains)
DROP POLICY IF EXISTS "Users can upload to their organization's folder" ON storage.objects;
-- Drop duplicate weaker SELECT/DELETE on company-documents (org_members_* and org_admins_* remain)
DROP POLICY IF EXISTS "Users can view their organization's documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their organization's documents" ON storage.objects;

-- Tighten email-assets INSERT: only active org members can upload, scoped to their org folder
DROP POLICY IF EXISTS "Authenticated users can upload email assets" ON storage.objects;
CREATE POLICY "Org members can upload email assets to their org folder"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'email-assets'
  AND (storage.foldername(name))[1] IN (
    SELECT organization_id::text FROM public.organization_members
    WHERE user_id = auth.uid() AND is_active = true
  )
);

-- Remove sensitive / unused tables from realtime publication so credentials and rule data
-- are no longer broadcast to all subscribers.
ALTER PUBLICATION supabase_realtime DROP TABLE public.integration_accounts;
ALTER PUBLICATION supabase_realtime DROP TABLE public.vendor_classification_rules;
ALTER PUBLICATION supabase_realtime DROP TABLE public.vendor_defaults;

-- Restrict hacienda_certificates SELECT: pin_hash and storage path should not be readable
-- by every org admin via API. Keep INSERT/UPDATE/DELETE for admins, restrict SELECT to service role.
DROP POLICY IF EXISTS "Admins can view organization certificates" ON public.hacienda_certificates;
CREATE POLICY "Admins can view certificate metadata only"
ON public.hacienda_certificates FOR SELECT
USING (false);
-- Server code uses the service role to read certificate material; admins do not need direct
-- access to pin_hash from the client.
