-- Automatic marketplace synchronization. All schedules use Kyiv local time.
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists pgcrypto with schema extensions;

alter database postgres set "cron.timezone" = 'Europe/Kyiv';

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

select cron.unschedule(jobid)
from cron.job
where jobname in (
  'crm-sync-prom-day', 'crm-sync-prom-night',
  'crm-sync-epicentr-day', 'crm-sync-epicentr-night',
  'crm-sync-kasta-day', 'crm-sync-kasta-night'
);

-- 08:00–22:59: each platform every 30 minutes, staggered by two minutes.
select cron.schedule('crm-sync-prom-day', '0,30 8-22 * * *', $$select public.invoke_crm_marketplace_sync('sync-prom-orders');$$);
select cron.schedule('crm-sync-epicentr-day', '2,32 8-22 * * *', $$select public.invoke_crm_marketplace_sync('sync-epicentr-orders');$$);
select cron.schedule('crm-sync-kasta-day', '4,34 8-22 * * *', $$select public.invoke_crm_marketplace_sync('sync-kasta-orders');$$);

-- 23:00–07:59: once an hour, keeping the same two-minute offsets.
select cron.schedule('crm-sync-prom-night', '0 0-7,23 * * *', $$select public.invoke_crm_marketplace_sync('sync-prom-orders');$$);
select cron.schedule('crm-sync-epicentr-night', '2 0-7,23 * * *', $$select public.invoke_crm_marketplace_sync('sync-epicentr-orders');$$);
select cron.schedule('crm-sync-kasta-night', '4 0-7,23 * * *', $$select public.invoke_crm_marketplace_sync('sync-kasta-orders');$$);
