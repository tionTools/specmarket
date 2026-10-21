begin;

create role anon;
create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable
as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable
as $$ select jsonb_build_object('email', current_setting('test.email', true)) $$;
select set_config('test.uid', '00000000-0000-0000-0000-000000000001', true);
select set_config('test.email', 'operator@example.com', true);

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
   '{"ttn":"20451562102801","trackingNormalizedStatus":"ready_for_pickup","trackingBuyerReceived":false,"trackingReturnInProgress":false}'),
  ('00000000-0000-0000-0000-000000000008', 433964214, 'Скасовано',
   '{"ttn":"20451562102802","trackingNormalizedStatus":"ready_for_pickup","trackingBuyerReceived":false,"trackingReturnInProgress":false}');

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

  perform public.crm_confirm_pickup_reminder_manual(
    '00000000-0000-0000-0000-000000000005', '20451562102799', 'viber');
  if not exists (
    select 1 from public.crm_pickup_reminder_log
    where order_id = '00000000-0000-0000-0000-000000000005'
      and stage = 'manual' and channel = 'viber' and deadline is null
      and actor_uid = '00000000-0000-0000-0000-000000000001'
  ) then raise exception 'manual acknowledgement without deadline missing'; end if;
  if exists (
    select 1 from public.crm_pickup_reminders
    where order_id = '00000000-0000-0000-0000-000000000005'
  ) then raise exception 'manual acknowledgement created a scheduled reminder'; end if;

  perform public.crm_confirm_pickup_reminder_manual(
    '00000000-0000-0000-0000-000000000002', '20451562102796', 'telegram');
  if not exists (
    select 1 from public.crm_pickup_reminder_log
    where order_id = '00000000-0000-0000-0000-000000000002'
      and stage = 'manual' and deadline = (now() at time zone 'Europe/Kyiv')::date
  ) then raise exception 'manual acknowledgement with deadline missing'; end if;
  if not exists (
    select 1 from public.crm_pickup_reminders
    where order_id = '00000000-0000-0000-0000-000000000002'
      and first_sent_at = '2026-10-20 07:17:15+00'::timestamptz
      and first_channel = 'viber' and last_sent_at is not null
      and last_channel = 'telegram'
  ) then raise exception 'manual acknowledgement changed FIRST/LAST'; end if;

  if has_function_privilege('anon',
       'public.crm_confirm_pickup_reminder_manual(uuid,text,text)', 'EXECUTE')
     or not has_function_privilege('authenticated',
       'public.crm_confirm_pickup_reminder_manual(uuid,text,text)', 'EXECUTE') then
    raise exception 'manual RPC execute privileges are wrong';
  end if;
  begin
    perform public.crm_confirm_pickup_reminder_manual(
      '00000000-0000-0000-0000-000000000005', '20451562102790', 'viber');
    raise exception 'stale TTN accepted';
  exception when raise_exception then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'CRM_REMINDER_SHIPMENT_CHANGED' then raise; end if;
  end;
  begin
    perform public.crm_confirm_pickup_reminder_manual(
      '00000000-0000-0000-0000-000000000006', '20451562102800', 'viber');
    raise exception 'received parcel accepted';
  exception when raise_exception then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'CRM_REMINDER_SHIPMENT_CHANGED' then raise; end if;
  end;
  begin
    perform public.crm_confirm_pickup_reminder_manual(
      '00000000-0000-0000-0000-000000000004', '20451562102798', 'viber');
    raise exception 'returning parcel accepted';
  exception when raise_exception then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'CRM_REMINDER_SHIPMENT_CHANGED' then raise; end if;
  end;
  begin
    perform public.crm_confirm_pickup_reminder_manual(
      '00000000-0000-0000-0000-000000000008', '20451562102802', 'viber');
    raise exception 'cancelled order accepted';
  exception when raise_exception then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'CRM_REMINDER_SHIPMENT_CHANGED' then raise; end if;
  end;
  begin
    perform public.crm_confirm_pickup_reminder_manual(
      '00000000-0000-0000-0000-000000000005', '20451562102799', null);
    raise exception 'null channel accepted';
  exception when raise_exception then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'CRM_REMINDER_INVALID_CHANNEL' then raise; end if;
  end;
  perform set_config('test.email', 'guest@gmail.com', true);
  begin
    perform public.crm_confirm_pickup_reminder_manual(
      '00000000-0000-0000-0000-000000000005', '20451562102799', 'viber');
    raise exception 'guest accepted';
  exception when raise_exception then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'CRM_AUTH_REQUIRED' then raise; end if;
  end;
  perform set_config('test.email', 'operator@example.com', true);
  perform set_config('test.uid', '', true);
  begin
    perform public.crm_confirm_pickup_reminder_manual(
      '00000000-0000-0000-0000-000000000005', '20451562102799', 'viber');
    raise exception 'anonymous accepted';
  exception when raise_exception then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'CRM_AUTH_REQUIRED' then raise; end if;
  end;

  perform set_config('test.uid', '00000000-0000-0000-0000-000000000001', true);
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
