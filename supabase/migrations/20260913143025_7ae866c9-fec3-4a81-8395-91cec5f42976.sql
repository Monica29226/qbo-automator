UPDATE public.system_settings
SET value = '0', updated_at = now()
WHERE key LIKE 'gmail_resume_cursor%'
  AND value <> '0';