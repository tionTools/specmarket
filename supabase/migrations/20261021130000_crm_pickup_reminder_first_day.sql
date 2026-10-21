-- Preserve existing acknowledgements while adding an append-only manual journal.
create table public.crm_pickup_reminder_log (
  id bigint generated always as identity primary key,
  order_id uuid not null,
  ttn text not null,
  deadline date not null,
  stage text not null check (stage in ('first', 'last')),
  channel text check (channel in ('telegram', 'viber')),
  acknowledged_at timestamptz not null,
  actor_uid uuid,
  origin text not null check (origin in ('rpc', 'backfill'))
);

insert into public.crm_pickup_reminder_log
  (order_id, ttn, deadline, stage, channel, acknowledged_at, origin)
select order_id, ttn, deadline, 'first', first_channel, first_sent_at, 'backfill'
from public.crm_pickup_reminders
where first_sent_at is not null
union all
select order_id, ttn, deadline, 'last', last_channel, last_sent_at, 'backfill'
from public.crm_pickup_reminders
where last_sent_at is not null;

alter table public.crm_pickup_reminder_log enable row level security;
revoke all on public.crm_pickup_reminder_log from public, anon, authenticated;
grant select on public.crm_pickup_reminder_log to authenticated;
create policy crm_pickup_reminder_log_read on public.crm_pickup_reminder_log
  for select to authenticated
  using (auth.uid() is not null and lower(coalesce(auth.jwt()->>'email','')) <> 'guest@gmail.com');

-- FIRST is available only one calendar day before the verified deadline.
-- LAST is independent of FIRST and old acknowledgements are never rewritten.
create or replace function public.crm_confirm_pickup_reminder(
  p_order_id uuid, p_ttn text, p_deadline date, p_stage text, p_channel text
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_updated uuid;
  v_days integer;
begin
  if auth.uid() is null or lower(coalesce(auth.jwt()->>'email','')) = 'guest@gmail.com' then
    raise exception 'CRM_AUTH_REQUIRED';
  end if;
  if p_stage not in ('first','last') or p_channel not in ('telegram','viber') then
    raise exception 'CRM_REMINDER_INVALID_STAGE';
  end if;
  v_days := p_deadline - (now() at time zone 'Europe/Kyiv')::date;
  if (p_stage = 'first' and v_days <> 1)
     or (p_stage = 'last' and v_days <> 0) then
    raise exception 'CRM_REMINDER_EXPIRED';
  end if;
  if not exists (
    select 1 from public.crm_orders o
    where o.id = p_order_id
      and btrim(coalesce(o.delivery->>'ttn','')) = btrim(p_ttn)
      and lower(coalesce(o.delivery->>'trackingNormalizedStatus','')) = 'ready_for_pickup'
      and coalesce(o.delivery->>'trackingBuyerReceived','false') <> 'true'
      and coalesce(o.delivery->>'trackingReturnInProgress','false') <> 'true'
  ) then
    raise exception 'CRM_REMINDER_SHIPMENT_CHANGED';
  end if;
  if p_stage = 'first' then
    update public.crm_pickup_reminders
       set first_sent_at = now(), first_channel = p_channel, updated_at = now()
     where order_id = p_order_id and ttn = btrim(p_ttn) and deadline = p_deadline
       and first_sent_at is null
     returning order_id into v_updated;
  else
    update public.crm_pickup_reminders
       set last_sent_at = now(), last_channel = p_channel, updated_at = now()
     where order_id = p_order_id and ttn = btrim(p_ttn) and deadline = p_deadline
       and last_sent_at is null
     returning order_id into v_updated;
  end if;
  if v_updated is null then raise exception 'CRM_REMINDER_ALREADY_SENT_OR_CHANGED'; end if;
  insert into public.crm_pickup_reminder_log
    (order_id, ttn, deadline, stage, channel, acknowledged_at, actor_uid, origin)
  values (p_order_id, btrim(p_ttn), p_deadline, p_stage, p_channel, now(), auth.uid(), 'rpc');
end;
$$;

revoke all on function public.crm_confirm_pickup_reminder(uuid,text,date,text,text)
  from public, anon, authenticated;
grant execute on function public.crm_confirm_pickup_reminder(uuid,text,date,text,text)
  to authenticated;

-- One server-side list for every phone: actionable deadlines and all other
-- waiting parcels, including pickup points without a verified deadline.
create function public.crm_list_pickup_reminders()
returns table (
  order_id uuid, order_number bigint, ttn text, carrier text,
  tracking_status text, deadline date, source text, days_left integer,
  category text, stage text, first_sent_at timestamptz,
  first_channel text, last_sent_at timestamptz, last_channel text
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or lower(coalesce(auth.jwt()->>'email','')) = 'guest@gmail.com' then
    raise exception 'CRM_AUTH_REQUIRED';
  end if;
  return query
  select o.id, o.order_number, btrim(o.delivery->>'ttn'),
    coalesce(r.carrier, o.delivery->>'carrier'),
    o.delivery->>'trackingStatus', r.deadline, r.source,
    r.deadline - (now() at time zone 'Europe/Kyiv')::date,
    case when r.deadline - (now() at time zone 'Europe/Kyiv')::date = 1
                  and r.first_sent_at is null
              or r.deadline = (now() at time zone 'Europe/Kyiv')::date
                  and r.last_sent_at is null
         then 'urgent' else 'informational' end,
    case when r.deadline - (now() at time zone 'Europe/Kyiv')::date = 1
                  and r.first_sent_at is null then 'first'
         when r.deadline = (now() at time zone 'Europe/Kyiv')::date
                  and r.last_sent_at is null then 'last'
         else null end,
    r.first_sent_at, r.first_channel, r.last_sent_at, r.last_channel
  from public.crm_orders o
  left join public.crm_pickup_reminders r
    on r.order_id = o.id and r.ttn = btrim(o.delivery->>'ttn')
  where nullif(btrim(o.delivery->>'ttn'), '') is not null
    and lower(coalesce(o.delivery->>'trackingNormalizedStatus','')) = 'ready_for_pickup'
    and coalesce(o.delivery->>'trackingBuyerReceived','false') <> 'true'
    and coalesce(o.delivery->>'trackingReturnInProgress','false') <> 'true'
    and coalesce(o.delivery->>'trackingReturnArrived','false') <> 'true'
    and lower(coalesce(o.status,'')) not in
      ('canceled','cancelled','completed','delivered','returned','скасовано','виконано','возврат');
end;
$$;

revoke all on function public.crm_list_pickup_reminders() from public, anon, authenticated;
grant execute on function public.crm_list_pickup_reminders() to authenticated;
