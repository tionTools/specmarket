create or replace function public.clear_crm_novapay_sync_log()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted_count integer := 0;
begin
  if auth.uid() is null
    or lower(coalesce(auth.jwt() ->> 'email', '')) = 'guest@gmail.com' then
    raise exception 'Not allowed to clear NovaPay sync journal';
  end if;

  delete from public.crm_novapay_sync_log;
  get diagnostics v_deleted_count = row_count;

  return v_deleted_count;
end;
$$;

revoke all on function public.clear_crm_novapay_sync_log()
from public, anon;
grant execute on function public.clear_crm_novapay_sync_log()
to authenticated;

notify pgrst, 'reload schema';
