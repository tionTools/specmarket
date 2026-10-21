begin;

create role anon;
create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable
as $$ select '00000000-0000-0000-0000-000000000001'::uuid $$;
create function auth.jwt() returns jsonb language sql stable
as $$ select '{"email":"operator@example.com"}'::jsonb $$;

create table public.crm_orders (
  id uuid primary key, order_number bigint, status text, delivery jsonb not null
);
create table public.crm_pickup_reminders (
  order_id uuid primary key,
  ttn text not null,
  deadline date not null,
  source text not null default 'manual',
  carrier text,
  first_sent_at timestamptz,
  first_channel text,
  last_sent_at timestamptz,
  last_channel text,
  updated_at timestamptz
);

insert into public.crm_orders (id, order_number, status, delivery) values
  ('00000000-0000-0000-0000-000000000002', 433964208, 'Принято',
   '{"ttn":"20451562102796","trackingNormalizedStatus":"ready_for_pickup","trackingBuyerReceived":false,"trackingReturnInProgress":false}'),
  ('00000000-0000-0000-0000-000000000003', 433964209, 'Принято',
   '{"ttn":"20451562102797","trackingNormalizedStatus":"ready_for_pickup","trackingBuyerReceived":false,"trackingReturnInProgress":false}'),
  ('00000000-0000-0000-0000-000000000004', 433964210, 'Принято',
   '{"ttn":"20451562102798","trackingNormalizedStatus":"ready_for_pickup","trackingBuyerReceived":false,"trackingReturnInProgress":true}'),
  ('00000000-0000-0000-0000-000000000005', 433964211, 'Принято',
   '{"ttn":"20451562102799","trackingNormalizedStatus":"ready_for_pickup","trackingBuyerReceived":false,"trackingReturnInProgress":false}'),
  ('00000000-0000-0000-0000-000000000006', 433964212, 'Принято',
   '{"ttn":"20451562102800","trackingNormalizedStatus":"ready_for_pickup","trackingBuyerReceived":true,"trackingReturnInProgress":false}'),
  ('00000000-0000-0000-0000-000000000007', 433964213, 'Принято',
   '{"ttn":"20451562102801","trackingNormalizedStatus":"ready_for_pickup","trackingBuyerReceived":false,"trackingReturnInProgress":false}');

insert into public.crm_pickup_reminders (order_id, ttn, deadline, first_sent_at, first_channel)
values
  ('00000000-0000-0000-0000-000000000002', '20451562102796',
   (now() at time zone 'Europe/Kyiv')::date, '2026-10-20 07:17:15+00', 'viber');
insert into public.crm_pickup_reminders (order_id, ttn, deadline)
values
  ('00000000-0000-0000-0000-000000000003', '20451562102797',
   (now() at time zone 'Europe/Kyiv')::date + 2),
  ('00000000-0000-0000-0000-000000000004', '20451562102798',
   (now() at time zone 'Europe/Kyiv')::date);
insert into public.crm_pickup_reminders (order_id, ttn, deadline, first_sent_at, first_channel)
values
  ('00000000-0000-0000-0000-000000000007', '20451562102801',
   (now() at time zone 'Europe/Kyiv')::date + 1, '2026-10-20 07:17:15+00', 'viber');

\ir ../migrations/20261021130000_crm_pickup_reminder_first_day.sql

do $$
declare
  v_message text;
begin
  if (select count(*) from public.crm_pickup_reminder_log where origin = 'backfill') <> 2 then
    raise exception 'existing acknowledgements were not backfilled';
  end if;
  if not exists (
    select 1 from public.crm_list_pickup_reminders()
    where order_id = '00000000-0000-0000-0000-000000000002'
      and category = 'urgent' and stage = 'last'
      and first_sent_at = '2026-10-20 07:17:15+00'::timestamptz
  ) then raise exception 'LAST missing for previously confirmed FIRST'; end if;
  if not exists (
    select 1 from public.crm_list_pickup_reminders()
    where order_id = '00000000-0000-0000-0000-000000000005'
      and category = 'informational' and stage is null and deadline is null
  ) then raise exception 'pickup point without deadline was lost'; end if;
  if not exists (
    select 1 from public.crm_list_pickup_reminders()
    where order_id = '00000000-0000-0000-0000-000000000007'
      and category = 'informational' and stage is null
  ) then raise exception 'previous FIRST was offered again'; end if;
  if exists (
    select 1 from public.crm_list_pickup_reminders()
    where order_id in ('00000000-0000-0000-0000-000000000004',
                       '00000000-0000-0000-0000-000000000006')
  ) then raise exception 'returned or received parcel appeared'; end if;

  begin
    perform public.crm_confirm_pickup_reminder(
      '00000000-0000-0000-0000-000000000003', '20451562102797',
      (now() at time zone 'Europe/Kyiv')::date + 2, 'first', 'viber');
    raise exception 'FIRST accepted two days early';
  exception when raise_exception then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'CRM_REMINDER_EXPIRED' then raise; end if;
  end;

  update public.crm_pickup_reminders
     set deadline = (now() at time zone 'Europe/Kyiv')::date + 1
   where order_id = '00000000-0000-0000-0000-000000000003';
  perform public.crm_confirm_pickup_reminder(
    '00000000-0000-0000-0000-000000000003', '20451562102797',
    (now() at time zone 'Europe/Kyiv')::date + 1, 'first', 'viber');
  if not exists (
    select 1 from public.crm_pickup_reminders
    where order_id = '00000000-0000-0000-0000-000000000003'
      and first_sent_at is not null and last_sent_at is null
  ) then raise exception 'FIRST was not independently recorded'; end if;

  perform public.crm_confirm_pickup_reminder(
    '00000000-0000-0000-0000-000000000002', '20451562102796',
    (now() at time zone 'Europe/Kyiv')::date, 'last', 'telegram');
  if not exists (
    select 1 from public.crm_pickup_reminders
    where order_id = '00000000-0000-0000-0000-000000000002'
      and first_sent_at = '2026-10-20 07:17:15+00'::timestamptz
      and first_channel = 'viber'
      and last_sent_at is not null and last_channel = 'telegram'
  ) then raise exception 'LAST did not preserve prior FIRST'; end if;
  if (select count(*) from public.crm_pickup_reminder_log
      where order_id = '00000000-0000-0000-0000-000000000002') <> 2 then
    raise exception 'LAST journal entry missing'; end if;

  begin
    perform public.crm_confirm_pickup_reminder(
      '00000000-0000-0000-0000-000000000004', '20451562102798',
      (now() at time zone 'Europe/Kyiv')::date, 'last', 'viber');
    raise exception 'returning parcel accepted';
  exception when raise_exception then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'CRM_REMINDER_SHIPMENT_CHANGED' then raise; end if;
  end;
end;
$$;

rollback;
