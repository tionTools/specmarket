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
rollback;
\echo 'PASS: current owner saves; expired/stale owners rejected; legacy bypass closed'
