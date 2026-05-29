
-- 1. Restrict sharepoint_admin_account credentials reads to service_role only
DROP POLICY IF EXISTS "Admins read sharepoint account" ON public.sharepoint_admin_account;
-- Insert/Update/Delete admin policies remain so admins can manage via edge functions
-- All client reads now must go through edge functions using service_role

-- 2. Remove permissive INSERT policy on organizations (creation must go through edge function)
DROP POLICY IF EXISTS "org_insert_allow_authenticated" ON public.organizations;

-- 3. Add missing UPDATE policy for invoice-imports storage bucket (admin-scoped, consistent)
CREATE POLICY "Admins can update invoice-imports files"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'invoice-imports'
  AND public.is_organization_admin(auth.uid(), ((storage.foldername(name))[1])::uuid)
)
WITH CHECK (
  bucket_id = 'invoice-imports'
  AND public.is_organization_admin(auth.uid(), ((storage.foldername(name))[1])::uuid)
);
