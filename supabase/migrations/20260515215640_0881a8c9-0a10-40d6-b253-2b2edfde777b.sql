UPDATE alert_history ah1
SET resolved = true, resolved_at = NOW()
WHERE resolved = false
  AND created_at < NOW() - INTERVAL '4 hours'
  AND EXISTS (
    SELECT 1 FROM alert_history ah2
    WHERE ah2.organization_id = ah1.organization_id
      AND ah2.alert_type = ah1.alert_type
      AND ah2.created_at > ah1.created_at
  );