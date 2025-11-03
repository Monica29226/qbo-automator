-- Create storage bucket for company documents
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'company-documents',
  'company-documents',
  false,
  10485760, -- 10MB limit
  ARRAY['application/pdf', 'application/xml', 'text/xml']
);

-- RLS policies for company documents bucket
CREATE POLICY "Users can view their organization's documents"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'company-documents' AND
  (storage.foldername(name))[1] IN (
    SELECT organization_id::text
    FROM organization_members
    WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Users can upload to their organization's folder"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'company-documents' AND
  (storage.foldername(name))[1] IN (
    SELECT organization_id::text
    FROM organization_members
    WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Users can delete their organization's documents"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'company-documents' AND
  (storage.foldername(name))[1] IN (
    SELECT organization_id::text
    FROM organization_members
    WHERE user_id = auth.uid()
  )
);

-- Add file_path column to processed_documents
ALTER TABLE processed_documents
ADD COLUMN file_path TEXT;