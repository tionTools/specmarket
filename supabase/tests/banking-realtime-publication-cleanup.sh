#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
PSQL=(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1)

if git grep -n "postgres_changes" --   src/features/banking   src/pages/BankStatementView.vue; then
  echo "Banking frontend must not use postgres_changes after Broadcast rollout." >&2
  exit 1
fi

"${PSQL[@]}" <<'SQL'
create table public.bank_account_cache (id bigint primary key);
create table public.bank_payment_events (id bigint primary key);
create table public.crm_novapay_sync_log (id bigint primary key);
create table public.realtime_publication_sentinel (id bigint primary key);

create publication supabase_realtime for table
  public.bank_account_cache,
  public.bank_payment_events,
  public.crm_novapay_sync_log,
  public.realtime_publication_sentinel;
SQL

"${PSQL[@]}" -f supabase/migrations/20261001112000_banking_realtime_publication_cleanup.sql >/dev/null

remaining="$("${PSQL[@]}" -Atqc "
  select string_agg(tablename, ',' order by tablename)
  from pg_publication_tables
  where pubname = 'supabase_realtime'
    and schemaname = 'public';
")"

if [[ "$remaining" != "realtime_publication_sentinel" ]]; then
  echo "Unexpected publication members after cleanup: $remaining" >&2
  exit 1
fi

# The migration is defensive/idempotent if replayed in an isolated verification database.
"${PSQL[@]}" -f supabase/migrations/20261001112000_banking_realtime_publication_cleanup.sql >/dev/null

remaining="$("${PSQL[@]}" -Atqc "
  select string_agg(tablename, ',' order by tablename)
  from pg_publication_tables
  where pubname = 'supabase_realtime'
    and schemaname = 'public';
")"

if [[ "$remaining" != "realtime_publication_sentinel" ]]; then
  echo "Unexpected publication members after second cleanup: $remaining" >&2
  exit 1
fi

echo "banking realtime publication cleanup: OK"
