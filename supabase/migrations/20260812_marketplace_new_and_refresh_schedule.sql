-- Two independent marketplace cycles, UTC-safe because pg_cron runs in the database timezone.
-- New orders arrive every five minutes; existing marketplace data is refreshed every fifteen.

create or replace function public.invoke_crm_marketplace_sync(function_name text, request_body jsonb)
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
    body := request_body
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function public.invoke_crm_marketplace_sync(text, jsonb) from public, anon, authenticated;
grant execute on function public.invoke_crm_marketplace_sync(text, jsonb) to postgres;

select cron.unschedule(jobid)
from cron.job
where jobname in (
  'crm-sync-prom-day', 'crm-sync-epicentr-day', 'crm-sync-kasta-day',
  'crm-sync-prom-night', 'crm-sync-epicentr-night', 'crm-sync-kasta-night',
  'crm-sync-prom-new', 'crm-sync-epicentr-new', 'crm-sync-kasta-new',
  'crm-refresh-prom', 'crm-refresh-epicentr', 'crm-refresh-kasta'
);

-- New orders: every 5 minutes, staggered so marketplaces do not start together.
select cron.schedule('crm-sync-prom-new', '*/5 * * * *', $$
  select public.invoke_crm_marketplace_sync('sync-prom-orders', '{"scheduled":true}'::jsonb);
$$);
select cron.schedule('crm-sync-epicentr-new', '1-59/5 * * * *', $$
  select public.invoke_crm_marketplace_sync('sync-epicentr-orders', '{"scheduled":true}'::jsonb);
$$);
select cron.schedule('crm-sync-kasta-new', '2-59/5 * * * *', $$
  select public.invoke_crm_marketplace_sync('sync-kasta-orders', '{"scheduled":true}'::jsonb);
$$);

-- Existing orders: every 15 minutes, also staggered. full=true updates the current marketplace page.
select cron.schedule('crm-refresh-prom', '3-59/15 * * * *', $$
  select public.invoke_crm_marketplace_sync('sync-prom-orders', '{"scheduled":true,"full":true}'::jsonb);
$$);
select cron.schedule('crm-refresh-epicentr', '8-59/15 * * * *', $$
  select public.invoke_crm_marketplace_sync('sync-epicentr-orders', '{"scheduled":true,"full":true}'::jsonb);
$$);
select cron.schedule('crm-refresh-kasta', '13-59/15 * * * *', $$
  select public.invoke_crm_marketplace_sync('sync-kasta-orders', '{"scheduled":true,"full":true}'::jsonb);
$$);
