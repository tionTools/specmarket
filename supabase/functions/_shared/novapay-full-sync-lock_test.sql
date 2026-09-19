-- Run only against a disposable local database named novapay_auth_test.
\set ON_ERROR_STOP on
begin;
do $$ begin
  if current_database() <> 'novapay_auth_test' then raise exception 'Disposable test database required'; end if;
end $$;
create role anon;
create role authenticated;
create role service_role;
\ir ../../migrations/20260919140000_novapay_full_sync_lock.sql

set role service_role;
do $$ begin
  if public.acquire_novapay_full_sync_lock('00000000-0000-0000-0000-000000000101', 600) is distinct from true then
    raise exception 'First owner did not acquire full sync lock';
  end if;
  if public.acquire_novapay_full_sync_lock('00000000-0000-0000-0000-000000000102', 600) is distinct from false then
    raise exception 'Concurrent owner acquired full sync lock';
  end if;
  if public.renew_novapay_full_sync_lock('00000000-0000-0000-0000-000000000101', 600) is distinct from true then
    raise exception 'Current owner could not renew full sync lock';
  end if;
  if public.release_novapay_full_sync_lock('00000000-0000-0000-0000-000000000102') is distinct from false then
    raise exception 'Stale owner released another owner lock';
  end if;
end $$;
reset role;

update public.novapay_full_sync_lock
set locked_until = clock_timestamp() - interval '1 second'
where lock_name = 'full-sync';

set role service_role;
do $$ begin
  if public.renew_novapay_full_sync_lock('00000000-0000-0000-0000-000000000101', 600) is distinct from false then
    raise exception 'Expired owner renewed full sync lock';
  end if;
  if public.acquire_novapay_full_sync_lock('00000000-0000-0000-0000-000000000102', 600) is distinct from true then
    raise exception 'New owner did not acquire expired full sync lock';
  end if;
  if public.release_novapay_full_sync_lock('00000000-0000-0000-0000-000000000101') is distinct from false then
    raise exception 'Old owner released new owner lock';
  end if;
  if public.renew_novapay_full_sync_lock('00000000-0000-0000-0000-000000000102', 600) is distinct from true then
    raise exception 'New owner lost full sync lock';
  end if;
  if public.release_novapay_full_sync_lock('00000000-0000-0000-0000-000000000102') is distinct from true then
    raise exception 'Current owner did not release full sync lock';
  end if;
end $$;
reset role;

do $$ begin
  if has_function_privilege('anon', 'public.acquire_novapay_full_sync_lock(uuid, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.acquire_novapay_full_sync_lock(uuid, integer)', 'execute')
     or has_function_privilege('anon', 'public.renew_novapay_full_sync_lock(uuid, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.renew_novapay_full_sync_lock(uuid, integer)', 'execute')
     or has_function_privilege('anon', 'public.release_novapay_full_sync_lock(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.release_novapay_full_sync_lock(uuid)', 'execute') then
    raise exception 'Full sync lock privileges are too broad';
  end if;
end $$;

rollback;
\echo 'PASS: full sync lock serializes owners, expires safely, and rejects stale release/renewal'
