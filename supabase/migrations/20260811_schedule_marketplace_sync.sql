
-- Automatic marketplace synchronization. All schedules use Kyiv local time.
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'crm_sync_cron_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'crm_sync_cron_secret',
      'Authorization key for scheduled CRM marketplace synchronization'
    );
  end if;
end;
$$;

create or replace function public.get_crm_sync_cron_secret()
returns text
language sql
security definer
set search_path = vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'crm_sync_cron_secret'
  limit 1;
$$;

revoke all on function public.get_crm_sync_cron_secret() from public, anon, authenticated;
grant execute on function public.get_crm_sync_cron_secret() to service_role;

create or replace function public.invoke_crm_marketplace_sync(function_name text)
returns bigint
language plpgsql
security definer
set search_path = net, vault, public
as $$
declare
  request_id bigint;
  cron_secret text;
begin
  select decrypted_secret into cron_secret
  from vault.decrypted_secrets
  where name = 'crm_sync_cron_secret'
  limit 1;

  select net.http_post(
    url := 'https://rtkhgldaswsclkorlyxx.supabase.co/functions/v1/' || function_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || cron_secret
    ),
    body := '{"scheduled":true}'::jsonb
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function public.invoke_crm_marketplace_sync(text) from public, anon, authenticated;
grant execute on function public.invoke_crm_marketplace_sync(text) to postgres;

create or replace function public.crm_marketplace_sync_is_due(platform text)
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  kyiv_time time := (now() at time zone 'Europe/Kyiv')::time;
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
  if kyiv_hour between 8 and 22 then
    return kyiv_minute in (platform_offset, platform_offset + 30);
  end if;
  return kyiv_minute = platform_offset;
end;
$$;

revoke all on function public.crm_marketplace_sync_is_due(text) from public, anon, authenticated;
grant execute on function public.crm_marketplace_sync_is_due(text) to postgres;

select cron.unschedule(jobid)
from cron.job
where jobname in (
  'crm-sync-prom-day', 'crm-sync-prom-night',
  'crm-sync-epicentr-day', 'crm-sync-epicentr-night',
  'crm-sync-kasta-day', 'crm-sync-kasta-night'
);

-- The scheduler checks every two minutes. The function gates real calls by Kyiv time,
-- so summer/winter time changes do not shift the business schedule.
select cron.schedule('crm-sync-prom-day', '*/2 * * * *', $$
  select case when public.crm_marketplace_sync_is_due('prom')
    then public.invoke_crm_marketplace_sync('sync-prom-orders') end;
$$);
select cron.schedule('crm-sync-epicentr-day', '*/2 * * * *', $$
  select case when public.crm_marketplace_sync_is_due('epicentr')
    then public.invoke_crm_marketplace_sync('sync-epicentr-orders') end;
$$);
select cron.schedule('crm-sync-kasta-day', '*/2 * * * *', $$
  select case when public.crm_marketplace_sync_is_due('kasta')
    then public.invoke_crm_marketplace_sync('sync-kasta-orders') end;
$$);
