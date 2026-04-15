UPDATE processed_documents 
SET status = 'processed', error_message = NULL, retry_count = 0
WHERE status = 'error' 
AND organization_id = 'e06ff1bc-bcfc-4158-a10c-5dbc9c6b0c2f'
AND id IN (
  '2039520b-d516-44b4-b245-057c02f2e8ab',
  'a6940b95-a7d7-47ac-b867-e2227ae0c737',
  '31f11403-ff3a-4309-9f2e-fddd675bc2f5',
  '17a51371-ffb7-4727-a321-77e3be19b92b',
  '010d8214-0b5e-4f2f-8ce6-8edced0e80f9',
  '64c5d95f-bf0e-47f4-b443-0161981a541d',
  '25e0e132-0a67-4ab8-bd6d-a74fe215b5dc',
  '71434635-db61-45ef-8b61-779ff2a2aed4',
  'f21060eb-7da2-4506-8f8b-99f9fdab227d',
  '17d35bc8-f11d-4fa0-a1df-122d34883867',
  '850d4be5-82fb-4f50-b1e1-aafb1176e215',
  'd0fe4520-f63c-4585-a517-accf8c3ab986',
  'acb1f532-8f79-4d61-89f1-c261dc4fb241',
  '89c1e648-3ec9-4db8-ad8f-39a4f0f3caf8',
  'ad3575d1-dce7-44e8-ab31-85b89352a61f'
);