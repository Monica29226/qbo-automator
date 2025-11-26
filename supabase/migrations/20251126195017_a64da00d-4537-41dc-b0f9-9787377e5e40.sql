-- Enable realtime for all critical tables

-- 1. Set REPLICA IDENTITY FULL to capture complete row data
ALTER TABLE public.vendor_classification_rules REPLICA IDENTITY FULL;
ALTER TABLE public.vendor_defaults REPLICA IDENTITY FULL;
ALTER TABLE public.integration_accounts REPLICA IDENTITY FULL;

-- 2. Add tables to supabase_realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.vendor_classification_rules;
ALTER PUBLICATION supabase_realtime ADD TABLE public.vendor_defaults;
ALTER PUBLICATION supabase_realtime ADD TABLE public.integration_accounts;