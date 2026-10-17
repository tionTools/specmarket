-- Patch 183: explicit, verified pickup deadlines and two manual reminder acknowledgements.
-- No duration is inferred from paid-storage dates or an estimated delivery date.
create table if not exists public.crm_pickup_reminders (
  order_id uuid primary key references public.crm_orders(id) on delete cascade,
  ttn text not null,
  deadline date not null,
  source text not null default 'manual' check (source in ('manual', 'carrier_rule')),
  carrier text,
  first_sent_at timestamptz,
  first_channel text,
  last_sent_at timestamptz,
  last_channel text,
  updated_at timestamptz not null default now(),
  constraint crm_pickup_reminders_ttn_nonempty check (length(btrim(ttn)) > 0),
  constraint crm_pickup_reminders_channels check (
    (first_channel is null or first_channel in ('telegram', 'viber'))
    and (last_channel is null or last_channel in ('telegram', 'viber'))
  )
);

alter table public.crm_pickup_reminders enable row level security;
revoke all on public.crm_pickup_reminders from public, anon;
grant select on public.crm_pickup_reminders to authenticated;

create policy crm_pickup_reminders_read on public.crm_pickup_reminders
  for select to authenticated
  using (auth.uid() is not null and lower(coalesce(auth.jwt()->>'email','')) <> 'guest@gmail.com');

create or replace function public.crm_set_pickup_reminder_deadline(
  p_order_id uuid, p_ttn text, p_deadline date
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or lower(coalesce(auth.jwt()->>'email','')) = 'guest@gmail.com' then
    raise exception 'CRM_AUTH_REQUIRED';
  end if;
  if p_order_id is null or p_deadline is null or nullif(btrim(p_ttn), '') is null
     or not exists (
       select 1 from public.crm_orders o
       where o.id = p_order_id and btrim(coalesce(o.delivery->>'ttn','')) = btrim(p_ttn)
     ) then
    raise exception 'CRM_REMINDER_SHIPMENT_CHANGED';
  end if;
  insert into public.crm_pickup_reminders (order_id, ttn, deadline)
  values (p_order_id, btrim(p_ttn), p_deadline)
  on conflict (order_id) do update
    set ttn = excluded.ttn,
        deadline = excluded.deadline,
        source = 'manual',
        carrier = null,
        first_sent_at = case
          when (public.crm_pickup_reminders.ttn, public.crm_pickup_reminders.deadline)
            is distinct from (excluded.ttn, excluded.deadline) then null
          else public.crm_pickup_reminders.first_sent_at end,
        first_channel = case
          when (public.crm_pickup_reminders.ttn, public.crm_pickup_reminders.deadline)
            is distinct from (excluded.ttn, excluded.deadline) then null
          else public.crm_pickup_reminders.first_channel end,
        last_sent_at = case
          when (public.crm_pickup_reminders.ttn, public.crm_pickup_reminders.deadline)
            is distinct from (excluded.ttn, excluded.deadline) then null
          else public.crm_pickup_reminders.last_sent_at end,
        last_channel = case
          when (public.crm_pickup_reminders.ttn, public.crm_pickup_reminders.deadline)
            is distinct from (excluded.ttn, excluded.deadline) then null
          else public.crm_pickup_reminders.last_channel end,
        updated_at = now();
end;
$$;

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
  if (p_stage = 'first' and v_days not between 1 and 2)
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
end;
$$;

revoke all on function public.crm_set_pickup_reminder_deadline(uuid,text,date) from public,anon,authenticated;
revoke all on function public.crm_confirm_pickup_reminder(uuid,text,date,text,text) from public,anon,authenticated;
grant execute on function public.crm_set_pickup_reminder_deadline(uuid,text,date) to authenticated;
grant execute on function public.crm_confirm_pickup_reminder(uuid,text,date,text,text) to authenticated;

-- Service-role only; background tracking never overwrites a manually corrected
-- deadline for the same tracking number. Updating a different shipment clears
-- the previous shipment's acknowledgements.
create or replace function public.crm_sync_pickup_reminder_auto(
  p_order_id uuid, p_ttn text, p_deadline date, p_carrier text
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_order_id is null or nullif(btrim(p_ttn), '') is null or
     p_deadline is null or nullif(btrim(p_carrier), '') is null then
    return;
  end if;
  if not exists (
    select 1 from public.crm_orders o
    where o.id = p_order_id
      and btrim(coalesce(o.delivery->>'ttn', '')) = btrim(p_ttn)
      and lower(coalesce(o.delivery->>'trackingNormalizedStatus','')) = 'ready_for_pickup'
      and coalesce(o.delivery->>'trackingBuyerReceived','false') <> 'true'
      and coalesce(o.delivery->>'trackingReturnInProgress','false') <> 'true'
      and lower(coalesce(o.status,'')) not in
          ('canceled','cancelled','completed','delivered','returned','скасовано','виконано')
  ) then return; end if;
  insert into public.crm_pickup_reminders (order_id, ttn, deadline, source, carrier)
  values (p_order_id, btrim(p_ttn), p_deadline, 'carrier_rule', btrim(p_carrier))
  on conflict (order_id) do update
    set ttn = excluded.ttn,
        deadline = excluded.deadline,
        source = 'carrier_rule',
        carrier = excluded.carrier,
        first_sent_at = case when
            (public.crm_pickup_reminders.ttn, public.crm_pickup_reminders.deadline)
            is distinct from (excluded.ttn, excluded.deadline)
            then null else public.crm_pickup_reminders.first_sent_at end,
        first_channel = case when
            (public.crm_pickup_reminders.ttn, public.crm_pickup_reminders.deadline)
            is distinct from (excluded.ttn, excluded.deadline)
            then null else public.crm_pickup_reminders.first_channel end,
        last_sent_at = case when
            (public.crm_pickup_reminders.ttn, public.crm_pickup_reminders.deadline)
            is distinct from (excluded.ttn, excluded.deadline)
            then null else public.crm_pickup_reminders.last_sent_at end,
        last_channel = case when
            (public.crm_pickup_reminders.ttn, public.crm_pickup_reminders.deadline)
            is distinct from (excluded.ttn, excluded.deadline)
            then null else public.crm_pickup_reminders.last_channel end,
        updated_at = now()
    where (public.crm_pickup_reminders.source <> 'manual'
           or public.crm_pickup_reminders.ttn <> excluded.ttn)
      and (public.crm_pickup_reminders.ttn,
           public.crm_pickup_reminders.deadline,
           public.crm_pickup_reminders.source,
           public.crm_pickup_reminders.carrier)
          is distinct from
          (excluded.ttn, excluded.deadline, excluded.source, excluded.carrier);
end;
$$;

revoke all on function public.crm_sync_pickup_reminder_auto(uuid,text,date,text)
  from public, anon, authenticated;
grant execute on function public.crm_sync_pickup_reminder_auto(uuid,text,date,text)
  to service_role;
