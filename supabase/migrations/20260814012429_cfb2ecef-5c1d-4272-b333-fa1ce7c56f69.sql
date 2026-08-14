create or replace function public.get_qbo_connection_status(_org_id uuid)
returns table(is_active boolean, expires_at_ms bigint, realm_id text, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.is_organization_member(auth.uid(), _org_id) or public.has_role(auth.uid(), 'admin')) then
    raise exception 'not authorized';
  end if;

  return query
  select ia.is_active,
         case
           when ia.credentials->>'expires_at' ~ '^[0-9]+$'
             then (ia.credentials->>'expires_at')::bigint
           when ia.credentials->>'expires_at' is not null
             then (extract(epoch from (ia.credentials->>'expires_at')::timestamptz) * 1000)::bigint
           else null
         end as expires_at_ms,
         ia.credentials->>'realm_id' as realm_id,
         ia.updated_at
  from public.integration_accounts ia
  where ia.organization_id = _org_id
    and ia.service_type = 'quickbooks'
  order by ia.updated_at desc
  limit 1;
end;
$$;

grant execute on function public.get_qbo_connection_status(uuid) to authenticated;