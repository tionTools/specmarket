-- Run only against a disposable local database named novapay_auth_test.
\set ON_ERROR_STOP on
begin;
do $$ begin
  if current_database() <> 'novapay_auth_test' then raise exception 'Disposable test database required'; end if;
end $$;
create role anon;
create role authenticated;
create role service_role;
\ir ../../migrations/20260916190000_novapay_rotation_lock.sql
create table public.test_auth_saves (token text);
create function public.save_novapay_auth_state(text, text, text, text) returns void
language sql security definer as $$ insert into public.test_auth_saves values ($1); $$;
revoke all on function public.save_novapay_auth_state(text, text, text, text) from public;
grant execute on function public.save_novapay_auth_state(text, text, text, text) to service_role;
\ir ../../migrations/20260919120000_novapay_owned_auth.sql
create table public.test_auth_pair (refresh_token text, public_certificate text);
insert into public.test_auth_pair values ('original', 'original');
create function public.get_novapay_auth_state() returns jsonb
language sql security definer as $$ select to_jsonb(p) from public.test_auth_pair p; $$;
\ir ../../migrations/20260919130000_novapay_auth_circuit_breaker.sql

set role service_role;
select public.acquire_novapay_rotation_lock_owned('00000000-0000-0000-0000-000000000001', 90);
select public.save_novapay_auth_state_owned('00000000-0000-0000-0000-000000000001', 'first', 'fake', 'fake', '123');
reset role;
update public.novapay_rotation_lock set locked_until = clock_timestamp() - interval '1 second';
set role service_role;
do $$ begin
  begin
    perform public.save_novapay_auth_state_owned('00000000-0000-0000-0000-000000000001', 'expired', 'fake', 'fake', '123');
    raise exception 'Expired owner was accepted';
  exception when sqlstate 'NP001' then null;
  end;
end $$;
select public.acquire_novapay_rotation_lock_owned('00000000-0000-0000-0000-000000000002', 90);
do $$ begin
  begin
    perform public.save_novapay_auth_state_owned('00000000-0000-0000-0000-000000000001', 'stale', 'fake', 'fake', '123');
    raise exception 'Stale owner was accepted';
  exception when sqlstate 'NP001' then null;
  end;
end $$;
select public.save_novapay_auth_state_owned('00000000-0000-0000-0000-000000000002', 'second', 'fake', 'fake', '123');
reset role;
do $$ begin
  if (select array_agg(token order by token) from public.test_auth_saves) <> array['first', 'second'] then
    raise exception 'Unexpected auth state writes';
  end if;
  if has_function_privilege('service_role', 'public.save_novapay_auth_state(text,text,text,text)', 'execute')
     or has_function_privilege('service_role', 'public.acquire_novapay_rotation_lock(uuid,integer)', 'execute') then
    raise exception 'Legacy RPC can bypass ownership protection';
  end if;
end $$;
-- A guard survives release and the next owner. Reset cannot bypass fresh-pair recovery.
set role service_role;
select public.begin_novapay_auth_rotation('00000000-0000-0000-0000-000000000002');
do $$ begin
  if public.acquire_novapay_rotation_lock_owned('00000000-0000-0000-0000-000000000003', 90) then
    raise exception 'Concurrent owner acquired an active rotation';
  end if;
end $$;
do $$ begin
  if (public.get_novapay_auth_state()->>'novapay_auth_uncertain')::boolean is distinct from true then
    raise exception 'Persistent guard was not exposed in auth state';
  end if;
end $$;
reset role;
do $$ declare rejected boolean := false; begin
  begin perform public.reset_novapay_auth_uncertain();
  exception when raise_exception then rejected := true; end;
  if not rejected then raise exception 'Reset allowed during active rotation'; end if;
end $$;
set role service_role;
select public.release_novapay_rotation_lock('00000000-0000-0000-0000-000000000002');
do $$ begin
  begin
    perform public.acquire_novapay_rotation_lock_owned('00000000-0000-0000-0000-000000000003', 90);
    raise exception 'Uncertain rotation was allowed';
  exception when sqlstate 'NP002' then null;
  end;
end $$;
reset role;
do $$ declare rejected boolean := false; begin
  begin perform public.reset_novapay_auth_uncertain();
  exception when raise_exception then rejected := true; end;
  if not rejected then raise exception 'Reset allowed with unchanged pair'; end if;
end $$;
update public.test_auth_pair set refresh_token = 'fresh', public_certificate = 'fresh';
select public.reset_novapay_auth_uncertain();
set role service_role;
do $$ begin
  if (public.get_novapay_auth_state()->>'novapay_auth_uncertain')::boolean is distinct from false then
    raise exception 'Manual reset did not clear guard';
  end if;
end $$;
select public.acquire_novapay_rotation_lock_owned('00000000-0000-0000-0000-000000000004', 90);
select public.begin_novapay_auth_rotation('00000000-0000-0000-0000-000000000004');
select public.save_novapay_auth_state_owned('00000000-0000-0000-0000-000000000004', 'returned', 'fake', 'fake', '123');
do $$ begin
  if (public.get_novapay_auth_state()->>'novapay_auth_uncertain')::boolean is distinct from false then
    raise exception 'Successful save did not clear guard';
  end if;
end $$;
reset role;
do $$ begin
  if has_function_privilege('service_role', 'public.reset_novapay_auth_uncertain()', 'execute')
     or has_function_privilege('authenticated', 'public.reset_novapay_auth_uncertain()', 'execute')
     or has_function_privilege('anon', 'public.reset_novapay_auth_uncertain()', 'execute')
     or has_function_privilege('service_role', 'public.get_novapay_auth_state_credentials()', 'execute') then
    raise exception 'Recovery privileges are too broad';
  end if;
end $$;
rollback;
\echo 'PASS: ownership, persistent guard, manual reset, successful save and RPC privileges'
