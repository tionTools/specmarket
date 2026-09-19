create table public.novapay_full_sync_lock (
  lock_name text primary key check (lock_name = 'full-sync'),
  owner_id uuid,
  locked_until timestamptz not null default '-infinity'::timestamptz
);

insert into public.novapay_full_sync_lock (lock_name)
values ('full-sync');

revoke all on table public.novapay_full_sync_lock from public, anon, authenticated, service_role;

create function public.acquire_novapay_full_sync_lock(
  lock_owner uuid,
  lease_seconds integer default 600
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  acquired boolean := false;
begin
  if lock_owner is null or lease_seconds < 60 or lease_seconds > 1800 then
    raise exception 'Invalid NovaPay full sync lock request';
  end if;

  update public.novapay_full_sync_lock
  set owner_id = lock_owner,
      locked_until = clock_timestamp() + make_interval(secs => lease_seconds)
  where lock_name = 'full-sync'
    and (
      owner_id is null
      or locked_until <= clock_timestamp()
    )
  returning true into acquired;

  return coalesce(acquired, false);
end;
$$;

create function public.renew_novapay_full_sync_lock(
  lock_owner uuid,
  lease_seconds integer default 600
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  renewed boolean := false;
begin
  if lock_owner is null or lease_seconds < 60 or lease_seconds > 1800 then
    raise exception 'Invalid NovaPay full sync lock renewal';
  end if;

  update public.novapay_full_sync_lock
  set locked_until = clock_timestamp() + make_interval(secs => lease_seconds)
  where lock_name = 'full-sync'
    and owner_id = lock_owner
    and locked_until > clock_timestamp()
  returning true into renewed;

  return coalesce(renewed, false);
end;
$$;

create function public.release_novapay_full_sync_lock(lock_owner uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  released boolean := false;
begin
  if lock_owner is null then
    return false;
  end if;

  update public.novapay_full_sync_lock
  set owner_id = null,
      locked_until = '-infinity'::timestamptz
  where lock_name = 'full-sync'
    and owner_id = lock_owner
  returning true into released;

  return coalesce(released, false);
end;
$$;

revoke all on function public.acquire_novapay_full_sync_lock(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.renew_novapay_full_sync_lock(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.release_novapay_full_sync_lock(uuid)
  from public, anon, authenticated;

grant execute on function public.acquire_novapay_full_sync_lock(uuid, integer) to service_role;
grant execute on function public.renew_novapay_full_sync_lock(uuid, integer) to service_role;
grant execute on function public.release_novapay_full_sync_lock(uuid) to service_role;

notify pgrst, 'reload schema';
