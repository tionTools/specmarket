-- Banking realtime now uses private Broadcast via realtime.send().
-- Keep the source tables out of the Postgres Changes publication so legacy
-- postgres_changes subscribers cannot keep WAL polling for these tables.

do $$
declare
  table_name text;
begin
  if not exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    return;
  end if;

  foreach table_name in array array[
    'bank_account_cache',
    'bank_payment_events',
    'crm_novapay_sync_log'
  ]
  loop
    if exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format(
        'alter publication supabase_realtime drop table public.%I',
        table_name
      );
    end if;
  end loop;
end
$$;
