select cron.schedule(
  'retry-sharepoint-uploads-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url:='https://lqirqvvkjpunhtsvebot.supabase.co/functions/v1/retry-sharepoint-uploads',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxxaXJxdnZranB1bmh0c3ZlYm90Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIxODIxNzMsImV4cCI6MjA3Nzc1ODE3M30.QNeuHDLzVyC2BU4etY0p4-EpQ9Yr9voPf60bMcDVkfE"}'::jsonb,
    body:='{}'::jsonb
  ) as request_id;
  $$
);