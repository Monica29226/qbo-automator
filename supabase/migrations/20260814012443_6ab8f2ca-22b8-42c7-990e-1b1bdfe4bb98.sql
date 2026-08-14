revoke execute on function public.get_qbo_connection_status(uuid) from public;
revoke execute on function public.get_qbo_connection_status(uuid) from anon;
grant execute on function public.get_qbo_connection_status(uuid) to authenticated;