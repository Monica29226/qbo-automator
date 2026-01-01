-- Create storage policies for company-documents bucket
-- Allow organization members to view documents in their organization's folder

-- Policy for SELECT: Members can view documents from their organization
CREATE POLICY "org_members_view_documents"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'company-documents'
  AND (storage.foldername(name))[1] IN (
    SELECT organization_id::text 
    FROM public.organization_members 
    WHERE user_id = auth.uid() 
    AND is_active = true
  )
);

-- Policy for INSERT: Members can upload documents to their organization
CREATE POLICY "org_members_upload_documents"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'company-documents'
  AND (storage.foldername(name))[1] IN (
    SELECT organization_id::text 
    FROM public.organization_members 
    WHERE user_id = auth.uid() 
    AND is_active = true
  )
);

-- Policy for UPDATE: Members can update documents in their organization
CREATE POLICY "org_members_update_documents"
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'company-documents'
  AND (storage.foldername(name))[1] IN (
    SELECT organization_id::text 
    FROM public.organization_members 
    WHERE user_id = auth.uid() 
    AND is_active = true
  )
);

-- Policy for DELETE: Only admins can delete documents
CREATE POLICY "org_admins_delete_documents"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'company-documents'
  AND EXISTS (
    SELECT 1 FROM public.organization_members 
    WHERE user_id = auth.uid() 
    AND organization_id::text = (storage.foldername(name))[1]
    AND role IN ('owner', 'admin')
    AND is_active = true
  )
);