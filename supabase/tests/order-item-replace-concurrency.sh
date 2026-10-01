#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

PSQL=(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1)

cleanup() {
  jobs -pr | xargs -r kill 2>/dev/null || true
}
trap cleanup EXIT

sql() {
  "${PSQL[@]}" -Atqc "$1"
}

reset_fixture() {
  "${PSQL[@]}" <<'SQL'
drop schema if exists test_probe cascade;
create schema test_probe;

drop function if exists public.replace_crm_order_items(uuid, jsonb);
drop function if exists public.touch_parent_crm_order_updated_at();
drop table if exists public.crm_order_items cascade;
drop table if exists public.crm_orders cascade;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'unprivileged_probe') then
    create role unprivileged_probe;
  end if;
end
$$;

create table public.crm_orders (
  id uuid primary key,
  updated_at timestamptz not null default now()
);

create table public.crm_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.crm_orders(id) on delete cascade,
  position integer not null,
  product_name text not null,
  size text not null default '',
  image_url text,
  quantity integer not null,
  price numeric not null,
  cost numeric not null,
  cost_usd numeric not null default 0,
  marketplace_product_key text,
  cost_manual boolean not null default false,
  price_item_id uuid,
  royalty_percent numeric,
  royalty_amount numeric,
  royalty_manual boolean not null default false
);

create table test_probe.parent_touches (
  order_id uuid not null,
  touched_at timestamptz not null default clock_timestamp()
);
SQL

  # The new migration is intentionally incremental: reproduce the real migration order.
  "${PSQL[@]}" -f supabase/migrations/20260930190000_order_item_replace_single_touch.sql >/dev/null
  "${PSQL[@]}" -f supabase/migrations/20261001100000_order_item_replace_serialization.sql >/dev/null

  "${PSQL[@]}" <<'SQL'
create or replace function test_probe.record_parent_touch()
returns trigger
language plpgsql
as $$
begin
  insert into test_probe.parent_touches(order_id) values (new.id);
  return null;
end;
$$;

create trigger test_probe_crm_orders_touch
after update on public.crm_orders
for each row execute function test_probe.record_parent_touch();

create trigger crm_order_items_touch_parent_updated_at
after insert or update or delete on public.crm_order_items
for each row execute function public.touch_parent_crm_order_updated_at();
SQL
}

order1="11111111-1111-1111-1111-111111111111"
order2="22222222-2222-2222-2222-222222222222"

payload_a='[
  {"position":0,"product_name":"A0","size":"L","quantity":1,"price":100,"cost":50,"cost_usd":0},
  {"position":1,"product_name":"A1","size":"M","quantity":2,"price":200,"cost":60,"cost_usd":0}
]'
payload_b='[
  {"position":0,"product_name":"B0","size":"S","quantity":3,"price":300,"cost":70,"cost_usd":0},
  {"position":1,"product_name":"B1","size":"XL","quantity":4,"price":400,"cost":80,"cost_usd":0}
]'
payload_seed='[
  {"position":0,"product_name":"SEED0","size":"L","quantity":1,"price":10,"cost":5,"cost_usd":0},
  {"position":1,"product_name":"SEED1","size":"M","quantity":1,"price":20,"cost":6,"cost_usd":0}
]'

assert_names() {
  local order_id="$1"
  local expected="$2"
  local actual
  actual="$(sql "select string_agg(product_name, ',' order by position) from public.crm_order_items where order_id = '$order_id'")"
  if [[ "$actual" != "$expected" ]]; then
    echo "Expected items $expected for $order_id, got $actual" >&2
    exit 1
  fi
}

LAST_PID=""

start_holding_replace() {
  local app_name="$1"
  local order_id="$2"
  local payload="$3"
  local hold_seconds="$4"
  PGAPPNAME="$app_name" "${PSQL[@]}" >/tmp/"$app_name".log 2>&1 <<SQL &
begin;
select public.replace_crm_order_items('$order_id'::uuid, '$payload'::jsonb);
select pg_sleep($hold_seconds);
commit;
SQL
  LAST_PID=$!
}

start_replace() {
  local app_name="$1"
  local order_id="$2"
  local payload="$3"
  PGAPPNAME="$app_name" "${PSQL[@]}" >/tmp/"$app_name".log 2>&1 <<SQL &
begin;
set local lock_timeout = '8s';
select public.replace_crm_order_items('$order_id'::uuid, '$payload'::jsonb);
commit;
SQL
  LAST_PID=$!
}

wait_for_advisory_block() {
  local app_name="$1"
  local found=""
  for _ in {1..40}; do
    found="$(sql "select coalesce(wait_event_type || ':' || wait_event, '') from pg_stat_activity where application_name = '$app_name'")"
    if [[ "$found" == "Lock:advisory" ]]; then
      return 0
    fi
    sleep 0.1
  done
  echo "Expected $app_name to wait on advisory lock, saw: $found" >&2
  cat /tmp/"$app_name".log >&2 || true
  exit 1
}

run_same_order_case() {
  local first_name="$1"
  local first_payload="$2"
  local second_name="$3"
  local second_payload="$4"
  local expected="$5"
  local seed_payload="${6:-}"

  sql "truncate public.crm_order_items, test_probe.parent_touches; insert into public.crm_orders(id) values ('$order1') on conflict (id) do nothing;"
  if [[ -n "$seed_payload" ]]; then
    sql "select public.replace_crm_order_items('$order1'::uuid, '$seed_payload'::jsonb); truncate test_probe.parent_touches;"
  fi

  local a_pid b_pid
  start_holding_replace "$first_name" "$order1" "$first_payload" 3
  a_pid=$LAST_PID
  sleep 0.4
  start_replace "$second_name" "$order1" "$second_payload"
  b_pid=$LAST_PID
  wait_for_advisory_block "$second_name"
  wait "$a_pid"
  wait "$b_pid"
  assert_names "$order1" "$expected"
}

reset_fixture

# Empty order: second replace waits, then fully wins.
run_same_order_case "replace-empty-a" "$payload_a" "replace-empty-b" "$payload_b" "B0,B1"

# Pre-filled order: same invariant.
run_same_order_case "replace-seeded-a" "$payload_a" "replace-seeded-b" "$payload_b" "B0,B1" "$payload_seed"

# Reverse order: last serialized replace wins as a complete set.
run_same_order_case "replace-reverse-b" "$payload_b" "replace-reverse-a" "$payload_a" "A0,A1"

# Different order IDs must not share the advisory lock.
sql "truncate public.crm_order_items, test_probe.parent_touches; insert into public.crm_orders(id) values ('$order1'), ('$order2') on conflict (id) do nothing;"
start_holding_replace "replace-order1-hold" "$order1" "$payload_a" 3
other_pid=$LAST_PID
sleep 0.4
PGAPPNAME="replace-order2" "${PSQL[@]}" >/tmp/replace-order2.log 2>&1 <<SQL
begin;
set local lock_timeout = '500ms';
select public.replace_crm_order_items('$order2'::uuid, '$payload_b'::jsonb);
commit;
SQL
if ! kill -0 "$other_pid" 2>/dev/null; then
  echo "order1 holder ended before independent order2 check completed" >&2
  exit 1
fi
assert_names "$order2" "B0,B1"
wait "$other_pid"

# #42 regression: identical payload is a true no-op, changed payload has one parent touch.
sql "truncate public.crm_order_items, test_probe.parent_touches; insert into public.crm_orders(id) values ('$order1') on conflict (id) do nothing; select public.replace_crm_order_items('$order1'::uuid, '$payload_a'::jsonb); truncate test_probe.parent_touches;"
sql "select public.replace_crm_order_items('$order1'::uuid, '$payload_a'::jsonb);"
touches="$(sql "select count(*) from test_probe.parent_touches where order_id = '$order1'")"
[[ "$touches" == "0" ]] || { echo "No-op replace touched parent $touches times" >&2; exit 1; }

sql "select public.replace_crm_order_items('$order1'::uuid, '$payload_b'::jsonb);"
touches="$(sql "select count(*) from test_probe.parent_touches where order_id = '$order1'")"
[[ "$touches" == "1" ]] || { echo "Changed replace touched parent $touches times" >&2; exit 1; }
assert_names "$order1" "B0,B1"

# Every field compared by #42 must still trigger exactly one parent touch when changed.
assert_variant_changes() {
  local label="$1"
  local path="$2"
  local value_sql="$3"
  local variant
  variant="$(sql "select jsonb_set('$payload_a'::jsonb, '$path', to_jsonb($value_sql))::text")"
  sql "select public.replace_crm_order_items('$order1'::uuid, '$payload_a'::jsonb); truncate test_probe.parent_touches;"
  sql "select public.replace_crm_order_items('$order1'::uuid, '$variant'::jsonb);"
  touches="$(sql "select count(*) from test_probe.parent_touches where order_id = '$order1'")"
  [[ "$touches" == "1" ]] || { echo "Field variant $label touched parent $touches times" >&2; exit 1; }
}

assert_variant_changes "position" "{0,position}" "9"
assert_variant_changes "product_name" "{0,product_name}" "'A0-x'::text"
assert_variant_changes "size" "{0,size}" "'XXL'::text"
assert_variant_changes "image_url" "{0,image_url}" "'img'::text"
assert_variant_changes "quantity" "{0,quantity}" "7"
assert_variant_changes "price" "{0,price}" "101"
assert_variant_changes "cost" "{0,cost}" "51"
assert_variant_changes "cost_usd" "{0,cost_usd}" "2"
assert_variant_changes "marketplace_product_key" "{0,marketplace_product_key}" "'key'::text"
assert_variant_changes "cost_manual" "{0,cost_manual}" "true"
assert_variant_changes "price_item_id" "{0,price_item_id}" "'33333333-3333-3333-3333-333333333333'::text"
assert_variant_changes "royalty_percent" "{0,royalty_percent}" "5"
assert_variant_changes "royalty_amount" "{0,royalty_amount}" "5"
assert_variant_changes "royalty_manual" "{0,royalty_manual}" "true"

# Array order is irrelevant; explicit NULL/default false values equal the omitted baseline.
sql "select public.replace_crm_order_items('$order1'::uuid, '$payload_a'::jsonb); truncate test_probe.parent_touches;"
reordered="$(sql "select jsonb_agg(value order by ord desc)::text from jsonb_array_elements('$payload_a'::jsonb) with ordinality as t(value, ord)")"
sql "select public.replace_crm_order_items('$order1'::uuid, '$reordered'::jsonb);"
touches="$(sql "select count(*) from test_probe.parent_touches where order_id = '$order1'")"
[[ "$touches" == "0" ]] || { echo "Array reordering unexpectedly changed items" >&2; exit 1; }

explicit_defaults="$(sql "select jsonb_set(jsonb_set(jsonb_set('$payload_a'::jsonb, '{0,image_url}', 'null'::jsonb), '{0,cost_manual}', 'false'::jsonb), '{0,royalty_manual}', 'false'::jsonb)::text")"
sql "select public.replace_crm_order_items('$order1'::uuid, '$explicit_defaults'::jsonb);"
touches="$(sql "select count(*) from test_probe.parent_touches where order_id = '$order1'")"
[[ "$touches" == "0" ]] || { echo "NULL/default-equivalent payload unexpectedly changed items" >&2; exit 1; }

# Direct item UPDATE first, then replace: no deadlock and replace still leaves one complete set.
sql "truncate public.crm_order_items, test_probe.parent_touches; insert into public.crm_orders(id) values ('$order1') on conflict (id) do nothing; select public.replace_crm_order_items('$order1'::uuid, '$payload_seed'::jsonb);"
PGAPPNAME="direct-update-first" "${PSQL[@]}" >/tmp/direct-update-first.log 2>&1 <<SQL &
begin;
update public.crm_order_items set cost = cost + 1 where order_id = '$order1' and position = 0;
select pg_sleep(2);
commit;
SQL
direct_pid=$!
sleep 0.3
PGAPPNAME="replace-after-direct" "${PSQL[@]}" >/tmp/replace-after-direct.log 2>&1 <<SQL
begin;
set local lock_timeout = '5s';
select public.replace_crm_order_items('$order1'::uuid, '$payload_b'::jsonb);
commit;
SQL
wait "$direct_pid"
assert_names "$order1" "B0,B1"

# Replace first, then direct UPDATE: no deadlock; raw UPDATE may apply after replace but cannot create A+B.
sql "select public.replace_crm_order_items('$order1'::uuid, '$payload_seed'::jsonb);"
start_holding_replace "replace-before-direct" "$order1" "$payload_b" 2
replace_pid=$LAST_PID
sleep 0.3
PGAPPNAME="direct-after-replace" "${PSQL[@]}" >/tmp/direct-after-replace.log 2>&1 <<SQL
begin;
set local lock_timeout = '5s';
update public.crm_order_items set cost = cost + 1 where order_id = '$order1' and position = 0;
commit;
SQL
wait "$replace_pid"
assert_names "$order1" "B0,B1"

# Current delete-order order (items first, then parent) must not deadlock with replace.
sql "truncate public.crm_order_items, test_probe.parent_touches; insert into public.crm_orders(id) values ('$order1') on conflict (id) do nothing; select public.replace_crm_order_items('$order1'::uuid, '$payload_seed'::jsonb);"
start_holding_replace "replace-before-delete" "$order1" "$payload_b" 2
replace_pid=$LAST_PID
sleep 0.3
PGAPPNAME="delete-after-replace" "${PSQL[@]}" >/tmp/delete-after-replace.log 2>&1 <<SQL
begin;
set local lock_timeout = '5s';
delete from public.crm_order_items where order_id = '$order1';
delete from public.crm_orders where id = '$order1';
commit;
SQL
wait "$replace_pid"
remaining="$(sql "select count(*) from public.crm_orders where id = '$order1'")"
[[ "$remaining" == "0" ]] || { echo "Delete-order path did not finish after replace" >&2; exit 1; }

# Delete starts first: replace may fail after parent deletion, but it must not deadlock or leave mixed items.
sql "insert into public.crm_orders(id) values ('$order1'); select public.replace_crm_order_items('$order1'::uuid, '$payload_seed'::jsonb);"
PGAPPNAME="delete-before-replace" "${PSQL[@]}" >/tmp/delete-before-replace.log 2>&1 <<SQL &
begin;
delete from public.crm_order_items where order_id = '$order1';
select pg_sleep(2);
delete from public.crm_orders where id = '$order1';
commit;
SQL
delete_pid=$!
sleep 0.3
set +e
PGAPPNAME="replace-after-delete" "${PSQL[@]}" >/tmp/replace-after-delete.log 2>&1 <<SQL
begin;
set local lock_timeout = '5s';
select public.replace_crm_order_items('$order1'::uuid, '$payload_b'::jsonb);
commit;
SQL
replace_after_delete_status=$?
set -e
wait "$delete_pid"
if [[ $replace_after_delete_status -eq 0 ]]; then
  remaining="$(sql "select count(*) from public.crm_order_items where order_id = '$order1'")"
  [[ "$remaining" == "0" ]] || { echo "Replace after delete left orphan/mixed items" >&2; exit 1; }
fi

# Invalid payload must roll back without leaking the transaction-local trigger guard.
sql "insert into public.crm_orders(id) values ('$order1') on conflict (id) do nothing; select public.replace_crm_order_items('$order1'::uuid, '$payload_b'::jsonb); truncate test_probe.parent_touches;"
set +e
"${PSQL[@]}" >/tmp/replace-error.log 2>&1 <<SQL
begin;
select public.replace_crm_order_items('$order1'::uuid, '{}'::jsonb);
commit;
SQL
error_status=$?
set -e
[[ $error_status -ne 0 ]] || { echo "Invalid payload unexpectedly succeeded" >&2; exit 1; }

sql "truncate test_probe.parent_touches; update public.crm_order_items set cost = cost + 1 where order_id = '$order1' and position = 0;"
touches="$(sql "select count(*) from test_probe.parent_touches where order_id = '$order1'")"
[[ "$touches" == "1" ]] || { echo "Direct item mutation did not touch parent after replace error" >&2; exit 1; }

# ACL/search_path/security-definer checks.
security_definer="$(sql "select prosecdef::text from pg_proc where oid = 'public.replace_crm_order_items(uuid,jsonb)'::regprocedure")"
[[ "$security_definer" == "true" ]] || { echo "replace function is not SECURITY DEFINER" >&2; exit 1; }

config="$(sql "select array_to_string(proconfig, ',') from pg_proc where oid = 'public.replace_crm_order_items(uuid,jsonb)'::regprocedure")"
[[ "$config" == *"search_path=pg_catalog, public"* ]] || { echo "Unexpected function config: $config" >&2; exit 1; }

for role in unprivileged_probe anon authenticated; do
  allowed="$(sql "select has_function_privilege('$role', 'public.replace_crm_order_items(uuid,jsonb)', 'EXECUTE')::text")"
  [[ "$allowed" == "false" ]] || { echo "$role unexpectedly has EXECUTE (PUBLIC baseline included)" >&2; exit 1; }
done
allowed="$(sql "select has_function_privilege('service_role', 'public.replace_crm_order_items(uuid,jsonb)', 'EXECUTE')::text")"
[[ "$allowed" == "true" ]] || { echo "service_role lacks EXECUTE" >&2; exit 1; }

echo "order item replace concurrency regression: OK"
