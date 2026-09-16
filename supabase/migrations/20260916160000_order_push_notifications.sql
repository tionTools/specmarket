create table if not exists public.crm_push_devices (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,
  fcm_token text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, device_id)
);

alter table public.crm_push_devices enable row level security;
revoke all on table public.crm_push_devices from public, anon, authenticated;

create index if not exists crm_push_devices_enabled_idx
  on public.crm_push_devices(enabled) where enabled;
create index if not exists crm_push_devices_token_idx
  on public.crm_push_devices(fcm_token);

create or replace function public.enqueue_crm_new_order_push()
returns trigger
language plpgsql
security definer
set search_path = net, vault, public
as $$
declare
  cron_secret text;
begin
  select decrypted_secret into cron_secret
  from vault.decrypted_secrets
  where name = 'crm_sync_cron_secret'
  limit 1;

  if cron_secret is null or cron_secret = '' then
    return new;
  end if;

  perform net.http_post(
    url := 'https://rtkhgldaswsclkorlyxx.supabase.co/functions/v1/send-order-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || cron_secret
    ),
    body := jsonb_build_object('orderId', new.id),
    timeout_milliseconds := 10000
  );
  return new;
end;
$$;

revoke all on function public.enqueue_crm_new_order_push() from public, anon, authenticated;

drop trigger if exists crm_orders_new_order_push on public.crm_orders;
create trigger crm_orders_new_order_push
after insert on public.crm_orders
for each row execute function public.enqueue_crm_new_order_push();
