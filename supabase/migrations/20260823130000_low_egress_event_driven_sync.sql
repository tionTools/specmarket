-- Low-egress order delivery: small state tables, private Broadcast and one due cron per marketplace.
create table if not exists public.crm_marketplace_order_sync_state (
  platform text not null,
  external_id text not null,
  order_id uuid not null references public.crm_orders(id) on delete cascade,
  source_hash text not null,
  synced_at timestamptz not null default now(),
  primary key (platform, external_id)
);
alter table public.crm_marketplace_order_sync_state enable row level security;

create table if not exists public.crm_delivery_tracking_state (
  order_id uuid primary key references public.crm_orders(id) on delete cascade,
  last_checked_at timestamptz,
  last_error text,
  provider text,
  details jsonb,
  updated_at timestamptz not null default now()
);
alter table public.crm_delivery_tracking_state enable row level security;

insert into public.crm_delivery_tracking_state (order_id, last_checked_at, last_error, provider, updated_at)
select id,
       nullif(delivery->>'trackingLastCheckedAt', '')::timestamptz,
       nullif(delivery->>'trackingLastError', ''),
       nullif(delivery->>'trackingProvider', ''), now()
from public.crm_orders
where nullif(delivery->>'trackingLastCheckedAt', '') is not null
  and (delivery->>'trackingLastCheckedAt') ~ '^\d{4}-\d\d-\d\dT'
on conflict (order_id) do nothing;

create or replace function public.broadcast_crm_order_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(jsonb_build_object('order_id', coalesce(new.id, old.id), 'operation', tg_op), 'order_changed', 'crm:orders', true);
  return coalesce(new, old);
end;
$$;
drop trigger if exists crm_orders_broadcast_change on public.crm_orders;
create trigger crm_orders_broadcast_change after insert or update or delete on public.crm_orders
for each row execute function public.broadcast_crm_order_change();

drop policy if exists "authenticated crm orders broadcast" on realtime.messages;
create policy "authenticated crm orders broadcast" on realtime.messages for select to authenticated
using (realtime.topic() = 'crm:orders' and extension = 'broadcast');

create or replace function public.crm_marketplace_sync_is_due(platform text, at_time timestamptz default now())
returns boolean language sql stable set search_path = '' as $$
  with local_time as (select at_time at time zone 'Europe/Kyiv' as value), offsets as (
    select case platform when 'Пром' then 0 when 'Эпицентр' then 1 when 'Каста' then 2 else -1 end as value
  ) select offsets.value >= 0 and case
    when extract(hour from local_time.value) between 7 and 23 then extract(minute from local_time.value)::int % 5 = offsets.value
    else extract(minute from local_time.value)::int = offsets.value
  end from local_time, offsets;
$$;

create or replace function public.get_crm_current_cost_totals()
returns jsonb language sql security definer set search_path = '' as $$
 select jsonb_build_object('usd', coalesce(sum(case when i.cost_usd > 0 then i.cost_usd * greatest(0, i.quantity - coalesce(r.returned_quantity, 0)) else 0 end), 0),
                           'uah', coalesce(sum(case when i.cost_usd > 0 then 0 else i.cost * greatest(0, i.quantity - coalesce(r.returned_quantity, 0)) end), 0))
 from public.crm_orders o join public.crm_order_items i on i.order_id = o.id
 left join public.crm_order_item_returns r on r.order_id = i.order_id and r.item_position = i.position
 where nullif(o.delivery->>'ttn', '') is not null;
$$;
revoke all on function public.get_crm_current_cost_totals() from public, anon;
grant execute on function public.get_crm_current_cost_totals() to authenticated;

select cron.unschedule(jobid) from cron.job where jobname in (
  'crm-sync-prom-new','crm-sync-epicentr-new','crm-sync-kasta-new','crm-refresh-prom','crm-refresh-epicentr','crm-refresh-kasta',
  'crm-sync-prom-day','crm-sync-epicentr-day','crm-sync-kasta-day','crm-sync-prom-night','crm-sync-epicentr-night','crm-sync-kasta-night'
);
select cron.schedule('crm-sync-prom-poll', '* * * * *', $$select case when public.crm_marketplace_sync_is_due('Пром') then public.invoke_crm_marketplace_sync('sync-prom-orders', '{"scheduled":true}'::jsonb) end;$$);
select cron.schedule('crm-sync-epicentr-poll', '* * * * *', $$select case when public.crm_marketplace_sync_is_due('Эпицентр') then public.invoke_crm_marketplace_sync('sync-epicentr-orders', '{"scheduled":true}'::jsonb) end;$$);
select cron.schedule('crm-sync-kasta-poll', '* * * * *', $$select case when public.crm_marketplace_sync_is_due('Каста') then public.invoke_crm_marketplace_sync('sync-kasta-orders', '{"scheduled":true}'::jsonb) end;$$);
