begin;
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end;
$$;
\ir ../migrations/20261103190000_kyt_usd_reference_rate.sql

do $$
declare
  saved public.crm_kyt_usd_rate%rowtype;
begin
  assert has_table_privilege('authenticated', 'public.crm_kyt_usd_rate', 'SELECT'), 'authenticated read denied';
  assert not has_table_privilege('authenticated', 'public.crm_kyt_usd_rate', 'UPDATE'), 'browser can write rate';
  assert not has_table_privilege('anon', 'public.crm_kyt_usd_rate', 'SELECT'), 'anonymous read allowed';
  assert not has_function_privilege('authenticated', 'public.save_crm_kyt_usd_rate(numeric,timestamptz)', 'EXECUTE'), 'browser can invoke writer';
  saved := public.save_crm_kyt_usd_rate(46.4, '2026-11-03 18:00:00+00');
  assert saved.sell_rate = 46.4, 'first value missing';
  saved := public.save_crm_kyt_usd_rate(47.1, '2026-11-03 18:01:00+00');
  assert saved.sell_rate = 47.1, 'newer value missing';
  saved := public.save_crm_kyt_usd_rate(45.9, '2026-11-03 18:00:30+00');
  assert saved.sell_rate = 47.1, 'older response overwrote newer value';
  assert (select count(*) = 1 from public.crm_kyt_usd_rate), 'multiple rate rows';
  assert (select fetched_at = saved.fetched_at from public.crm_kyt_usd_rate), 'older response changed timestamp';
end;
$$;
rollback;
