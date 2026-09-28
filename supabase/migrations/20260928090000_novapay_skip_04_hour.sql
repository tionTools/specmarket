-- Skip the 04:00 Europe/Kyiv NovaPay sync window while preserving the existing cadence.
create or replace function public.crm_novapay_sync_is_due()
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  kyiv_hour integer := extract(hour from (now() at time zone 'Europe/Kyiv'));
  kyiv_minute integer := extract(minute from (now() at time zone 'Europe/Kyiv'));
begin
  if kyiv_minute not in (0, 15, 30, 45) then
    return false;
  end if;

  if kyiv_hour = 4 then
    return false;
  end if;

  if kyiv_hour = 0 or kyiv_hour >= 7 then
    return true;
  end if;

  return kyiv_minute = 0;
end;
$$;

revoke all on function public.crm_novapay_sync_is_due() from public, anon, authenticated, service_role;
grant execute on function public.crm_novapay_sync_is_due() to postgres;
