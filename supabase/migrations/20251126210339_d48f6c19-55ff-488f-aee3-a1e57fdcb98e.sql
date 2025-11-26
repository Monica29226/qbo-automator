-- Add Google Drive file IDs to processed_documents table
ALTER TABLE processed_documents 
ADD COLUMN google_drive_pdf_id TEXT,
ADD COLUMN google_drive_xml_id TEXT,
ADD COLUMN google_drive_uploaded_at TIMESTAMP WITH TIME ZONE;