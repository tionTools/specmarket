create table if not exists public.crm_push_devices (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,
  fcm_token text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, device_id)
);

alter table public.crm_push_devices enable row level security;
revoke all on table public.crm_push_devices from public, anon;
grant select, insert, update, delete on table public.crm_push_devices to authenticated;

create index if not exists crm_push_devices_enabled_idx
  on public.crm_push_devices(enabled) where enabled;
create index if not exists crm_push_devices_token_idx
  on public.crm_push_devices(fcm_token);

drop policy if exists "own push devices select" on public.crm_push_devices;
create policy "own push devices select"
on public.crm_push_devices for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "own push devices insert" on public.crm_push_devices;
create policy "own push devices insert"
on public.crm_push_devices for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "own push devices update" on public.crm_push_devices;
create policy "own push devices update"
on public.crm_push_devices for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "own push devices delete" on public.crm_push_devices;
create policy "own push devices delete"
on public.crm_push_devices for delete to authenticated
using ((select auth.uid()) = user_id);

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
