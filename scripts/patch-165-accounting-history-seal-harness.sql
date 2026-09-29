\set ON_ERROR_STOP on

-- Test-only minimal schema: only columns/types read by Patch 165 and the
-- reviewed production cost function are represented here.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create table public.crm_orders (
  id uuid primary key,
  status text not null default '',
  delivery jsonb not null default '{}'::jsonb
);

create table public.crm_order_items (
  order_id uuid not null references public.crm_orders(id),
  position integer not null,
  product_name text not null,
  quantity numeric not null,
  cost numeric not null default 0,
  cost_usd numeric not null default 0,
  primary key (order_id, position)
);

create table public.crm_order_item_returns (
  order_id uuid not null,
  item_position integer not null,
  returned_quantity numeric not null default 0,
  returned_at date,
  updated_at timestamptz not null default now(),
  primary key (order_id, item_position)
);

create table public.crm_reconciliations (
  id uuid primary key,
  kind text not null,
  reconciled_at timestamptz not null,
  cost_snapshot_usd numeric not null,
  cost_snapshot_uah numeric not null,
  created_at timestamptz not null default now()
);

create table public.patch_165_results (
  scenario text primary key,
  expected jsonb not null,
  actual jsonb not null
);

create or replace function public.patch_165_assert_totals(
  p_scenario text,
  p_usd numeric,
  p_uah numeric
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_actual jsonb;
  v_usd numeric;
  v_uah numeric;
begin
  select public.get_crm_current_cost_totals() into v_actual;
  v_usd := (v_actual ->> 'usd')::numeric;
  v_uah := (v_actual ->> 'uah')::numeric;
  if v_usd <> p_usd or v_uah <> p_uah then
    raise exception 'Patch 165 % failed: expected USD %, UAH %; actual USD %, UAH %',
      p_scenario, p_usd, p_uah, v_usd, v_uah;
  end if;
  insert into public.patch_165_results (scenario, expected, actual)
  values (p_scenario, jsonb_build_object('usd', p_usd, 'uah', p_uah), v_actual);
end;
$$;

create or replace function public.patch_165_assert_true(
  p_scenario text,
  p_actual boolean
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not p_actual then
    raise exception 'Patch 165 % failed: expected true, actual false', p_scenario;
  end if;
  insert into public.patch_165_results (scenario, expected, actual)
  values (p_scenario, 'true'::jsonb, to_jsonb(p_actual));
end;
$$;

-- Install the exact reviewed production function before Patch 165.
\i supabase/migrations/20260928125000_carrier_deleted_ttn_accounting.sql

insert into public.crm_orders (id, status, delivery) values
  ('00000000-0000-0000-0000-000000000001', 'active', jsonb_build_object('ttn', 'A', 'trackingNormalizedStatus', 'delivered')),
  ('00000000-0000-0000-0000-000000000002', 'active', jsonb_build_object('ttn', 'B', 'trackingNormalizedStatus', 'delivered', 'trackingReturnArrived', true)),
  ('00000000-0000-0000-0000-000000000003', 'active', jsonb_build_object('ttn', 'C', 'trackingNormalizedStatus', 'delivered')),
  ('00000000-0000-0000-0000-000000000004', 'active', jsonb_build_object('ttn', 'D', 'trackingNormalizedStatus', 'deleted')),
  ('00000000-0000-0000-0000-000000000005', 'canceled', jsonb_build_object('ttn', 'E')),
  ('00000000-0000-0000-0000-000000000006', 'active', '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000007', 'active', jsonb_build_object('ttn', 'G', 'trackingNormalizedStatus', 'delivered'));

insert into public.crm_order_items (order_id, position, product_name, quantity, cost, cost_usd) values
  ('00000000-0000-0000-0000-000000000001', 0, 'delivered', 2, 0, 10),
  ('00000000-0000-0000-0000-000000000002', 0, 'return-arrived', 2, 0, 5),
  ('00000000-0000-0000-0000-000000000003', 0, 'pre-seal-return', 3, 0, 8),
  ('00000000-0000-0000-0000-000000000004', 0, 'deleted', 1, 0, 50),
  ('00000000-0000-0000-0000-000000000005', 0, 'zero-canceled', 1, 0, 40),
  ('00000000-0000-0000-0000-000000000006', 0, 'future', 1, 0, 7),
  ('00000000-0000-0000-0000-000000000007', 0, 'delivered-uah', 2, 100, 0);

insert into public.crm_order_item_returns (order_id, item_position, returned_quantity, returned_at, updated_at)
values ('00000000-0000-0000-0000-000000000003', 0, 1, date '2026-09-28', timestamptz '2026-09-28 12:00:00+03');

select public.patch_165_assert_totals('pre_patch_production_formula', 46, 200);

-- Apply Patch 165 only to this isolated database.
\i supabase/migrations/20260929120000_accounting_history_seal.sql

select public.patch_165_assert_totals('before_seal_exact_totals_match', 46, 200);
select public.patch_165_assert_true('tracking_return_arrived_has_no_manual_return',
  not exists (select 1 from public.crm_order_item_returns where order_id = '00000000-0000-0000-0000-000000000002')
);

insert into public.crm_reconciliations (
  id, kind, reconciled_at, cost_snapshot_usd, cost_snapshot_uah, created_at
) values (
  '00000000-0000-0000-0000-000000000010', 'reconciliation',
  timestamptz '2026-09-29 10:00:00+03', 46, 200, timestamptz '2026-09-29 10:00:00+03'
);

select public.patch_165_assert_true('seal_succeeds',
  (public.seal_crm_accounting_history() ->> 'ok')::boolean
);
select public.patch_165_assert_totals('pre_seal_accepted_return_is_baseline', 46, 200);
select public.patch_165_assert_true('ordinary_delivered_is_included',
  exists (
    select 1 from public.crm_accounting_history_lock_orders
    where order_id = '00000000-0000-0000-0000-000000000001' and included_at_seal
  )
);
select public.patch_165_assert_true('deleted_ttn_excluded',
  exists (
    select 1 from public.crm_accounting_history_lock_orders
    where order_id = '00000000-0000-0000-0000-000000000004' and not included_at_seal
  )
);
select public.patch_165_assert_true('pre_seal_return_snapshotted',
  exists (
    select 1 from public.crm_accounting_history_lock_items
    where order_id = '00000000-0000-0000-0000-000000000003'
      and item_position = 0 and returned_quantity_at_seal = 1
  )
);
select public.patch_165_assert_true('clean_future_order_not_locked',
  not exists (
    select 1 from public.crm_accounting_history_lock_orders
    where order_id = '00000000-0000-0000-0000-000000000006'
  )
);

-- Stale historical updates and a new item cannot alter a locked contribution.
update public.crm_orders
set status = 'canceled', delivery = jsonb_build_object('ttn', 'STALE', 'trackingNormalizedStatus', 'deleted')
where id = '00000000-0000-0000-0000-000000000001';
update public.crm_order_items
set quantity = 99, cost_usd = 999
where order_id = '00000000-0000-0000-0000-000000000001' and position = 0;
insert into public.crm_order_items (order_id, position, product_name, quantity, cost, cost_usd)
values ('00000000-0000-0000-0000-000000000001', 1, 'late-item', 3, 0, 999);
update public.crm_orders
set status = 'active', delivery = jsonb_build_object('ttn', 'RESURRECT', 'trackingNormalizedStatus', 'delivered')
where id = '00000000-0000-0000-0000-000000000005';
update public.crm_order_items
set quantity = 99, cost_usd = 999
where order_id = '00000000-0000-0000-0000-000000000005';
update public.crm_orders
set delivery = jsonb_build_object('ttn', 'F', 'trackingNormalizedStatus', 'delivered')
where id = '00000000-0000-0000-0000-000000000006';

select public.patch_165_assert_totals('locked_updates_zero_resurrection_new_item_and_future_live', 53, 200);
select public.patch_165_assert_true('late_item_not_snapshotted_for_locked_order',
  not exists (
    select 1 from public.crm_accounting_history_lock_items
    where order_id = '00000000-0000-0000-0000-000000000001' and item_position = 1
  )
);

-- A genuine post-boundary accepted return reduces the frozen positive baseline.
insert into public.crm_order_item_returns (order_id, item_position, returned_quantity, returned_at, updated_at)
values ('00000000-0000-0000-0000-000000000001', 0, 1, date '2026-09-30', timestamptz '2026-09-30 12:00:00+03');
select public.patch_165_assert_totals('post_seal_manual_return_reduces_debt', 43, 200);

-- A changed historical return remains frozen at its pre-seal accepted quantity.
update public.crm_order_item_returns
set returned_quantity = 2, returned_at = date '2026-09-28', updated_at = timestamptz '2026-09-30 12:00:00+03'
where order_id = '00000000-0000-0000-0000-000000000003';
select public.patch_165_assert_totals('backdated_return_does_not_rewrite_history', 43, 200);
update public.crm_order_item_returns
set returned_quantity = 0, returned_at = date '2026-09-28', updated_at = timestamptz '2026-09-30 13:00:00+03'
where order_id = '00000000-0000-0000-0000-000000000003';
select public.patch_165_assert_totals('reducing_pre_seal_return_cannot_resurrect_cost', 43, 200);

select public.patch_165_assert_true('rls_enabled_and_service_role_read_only',
  (select bool_and(c.relrowsecurity)
   from pg_class c
   where c.oid in (
     'public.crm_accounting_history_lock'::regclass,
     'public.crm_accounting_history_lock_orders'::regclass,
     'public.crm_accounting_history_lock_items'::regclass
   ))
  and has_table_privilege('service_role', 'public.crm_accounting_history_lock', 'select')
  and not has_table_privilege('service_role', 'public.crm_accounting_history_lock', 'insert')
  and not has_table_privilege('anon', 'public.crm_accounting_history_lock', 'select')
  and not has_table_privilege('authenticated', 'public.crm_accounting_history_lock', 'select')
);
select public.patch_165_assert_true('seal_execute_service_role_only',
  has_function_privilege('service_role', 'public.seal_crm_accounting_history()', 'execute')
  and not has_function_privilege('anon', 'public.seal_crm_accounting_history()', 'execute')
  and not has_function_privilege('authenticated', 'public.seal_crm_accounting_history()', 'execute')
);

select * from public.patch_165_results order by scenario;
