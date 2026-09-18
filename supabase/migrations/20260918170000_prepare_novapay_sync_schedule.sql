-- Prepare automatic NovaPay synchronization. The schedule is installed disabled by default.
-- Enable it explicitly with: select public.enable_crm_novapay_sync();
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

create or replace function public.invoke_crm_novapay_sync()
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

  if nullif(cron_secret, '') is null then
    raise exception 'CRM sync cron secret is missing';
  end if;

  select net.http_post(
    url := 'https://rtkhgldaswsclkorlyxx.supabase.co/functions/v1/novapay-data',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || cron_secret
    ),
    body := '{"scheduled":true,"refresh":true,"compact":true}'::jsonb
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function public.invoke_crm_novapay_sync() from public, anon, authenticated, service_role;
grant execute on function public.invoke_crm_novapay_sync() to postgres;

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

  if kyiv_hour = 0 or kyiv_hour >= 7 then
    return true;
  end if;

  return kyiv_minute = 0;
end;
$$;

revoke all on function public.crm_novapay_sync_is_due() from public, anon, authenticated, service_role;
grant execute on function public.crm_novapay_sync_is_due() to postgres;

create or replace function public.disable_crm_novapay_sync()
returns integer
language plpgsql
security definer
set search_path = cron, public
as $$
declare
  removed integer := 0;
  target_job record;
begin
  for target_job in
    select jobid
    from cron.job
    where jobname = 'crm-sync-novapay'
  loop
    perform cron.unschedule(target_job.jobid);
    removed := removed + 1;
  end loop;

  return removed;
end;
$$;

revoke all on function public.disable_crm_novapay_sync() from public, anon, authenticated, service_role;
grant execute on function public.disable_crm_novapay_sync() to postgres;

create or replace function public.enable_crm_novapay_sync()
returns bigint
language plpgsql
security definer
set search_path = cron, public
as $$
declare
  job_id bigint;
begin
  perform public.disable_crm_novapay_sync();

  select cron.schedule(
    'crm-sync-novapay',
    '*/15 * * * *',
    'select case when public.crm_novapay_sync_is_due() then public.invoke_crm_novapay_sync() end;'
  ) into job_id;

  return job_id;
end;
$$;

revoke all on function public.enable_crm_novapay_sync() from public, anon, authenticated, service_role;
grant execute on function public.enable_crm_novapay_sync() to postgres;

-- Keep NovaPay cron disabled after this migration. It will not create a job until
-- enable_crm_novapay_sync() is called explicitly.
select public.disable_crm_novapay_sync();
