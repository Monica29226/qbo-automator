UPDATE processed_documents 
SET status = 'processed', error_message = NULL, retry_count = 0
WHERE id IN (
  '2039520b-d516-44b4-b245-057c02f2e8ab',
  '63a565c2-3d85-48ba-8a94-e0dab7c73c79',
  'a6940b95-a7d7-47ac-b867-e2227ae0c737',
  '31f11403-ff3a-4309-9f2e-fddd675bc2f5',
  '010d8214-0b5e-4f2f-8ce6-8edced0e80f9',
  '64c5d95f-bf0e-47f4-b443-0161981a541d',
  '1febddd3-5734-49f3-b21e-e0bb04218334',
  'f7c5a7f6-c567-472c-9537-d13819926fd2'
)
AND status = 'error'
AND supplier_name ILIKE '%LAB SAN JOSE%';