-- Marketplace polling cadence in Kyiv time:
-- 07:00–23:59: every 15 minutes, staggered by marketplace.
-- 00:00–06:59: once per hour, also staggered.
create or replace function public.crm_marketplace_sync_is_due(platform text)
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  kyiv_hour integer := extract(hour from (now() at time zone 'Europe/Kyiv'));
  kyiv_minute integer := extract(minute from (now() at time zone 'Europe/Kyiv'));
  platform_offset integer;
begin
  platform_offset := case platform
    when 'prom' then 0
    when 'epicentr' then 2
    when 'kasta' then 4
    else -1
  end;

  if platform_offset < 0 then return false; end if;

  if kyiv_hour between 7 and 23 then
    return kyiv_minute in (
      platform_offset,
      platform_offset + 15,
      platform_offset + 30,
      platform_offset + 45
    );
  end if;

  return kyiv_minute = platform_offset;
end;
$$;

select cron.unschedule(jobid)
from cron.job
where jobname in (
  'crm-sync-prom-day',
  'crm-sync-epicentr-day',
  'crm-sync-kasta-day'
);

-- Run the lightweight gate each minute; it calls a marketplace only at the
-- exact minutes allowed by crm_marketplace_sync_is_due.
select cron.schedule('crm-sync-prom-day', '* * * * *', $$
  select case when public.crm_marketplace_sync_is_due('prom')
    then public.invoke_crm_marketplace_sync('sync-prom-orders') end;
$$);
select cron.schedule('crm-sync-epicentr-day', '* * * * *', $$
  select case when public.crm_marketplace_sync_is_due('epicentr')
    then public.invoke_crm_marketplace_sync('sync-epicentr-orders') end;
$$);
select cron.schedule('crm-sync-kasta-day', '* * * * *', $$
  select case when public.crm_marketplace_sync_is_due('kasta')
    then public.invoke_crm_marketplace_sync('sync-kasta-orders') end;
$$);
