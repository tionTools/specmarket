-- Allow the scheduled NovaPay Edge Function enough time to return its final response.
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
    body := '{"scheduled":true,"refresh":true,"compact":true}'::jsonb,
    timeout_milliseconds := 180000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function public.invoke_crm_novapay_sync() from public, anon, authenticated, service_role;
grant execute on function public.invoke_crm_novapay_sync() to postgres;
