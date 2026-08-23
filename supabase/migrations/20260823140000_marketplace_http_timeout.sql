-- Marketplace APIs routinely take longer than pg_net's 5-second default.
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
  select decrypted_secret into cron_secret from vault.decrypted_secrets where name = 'crm_sync_cron_secret' limit 1;
  select net.http_post(
    url := 'https://rtkhgldaswsclkorlyxx.supabase.co/functions/v1/' || function_name,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || cron_secret),
    body := request_body,
    timeout_milliseconds := 60000
  ) into request_id;
  return request_id;
end;
$$;
