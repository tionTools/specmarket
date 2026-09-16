create table if not exists public.novapay_rotation_lock (
  lock_name text primary key,
  owner_id uuid,
  locked_until timestamptz not null default '-infinity'::timestamptz
);

insert into public.novapay_rotation_lock (lock_name)
values ('credentials')
on conflict (lock_name) do nothing;

alter table public.novapay_rotation_lock enable row level security;
revoke all on table public.novapay_rotation_lock from public, anon, authenticated;

create or replace function public.acquire_novapay_rotation_lock(
  lock_owner uuid,
  lease_seconds integer default 90
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  acquired boolean;
begin
  if lock_owner is null then
    raise exception 'lock_owner is required';
  end if;

  if lease_seconds < 10 or lease_seconds > 120 then
    raise exception 'lease_seconds must be between 10 and 120';
  end if;

  insert into public.novapay_rotation_lock (lock_name)
  values ('credentials')
  on conflict (lock_name) do nothing;

  update public.novapay_rotation_lock
  set owner_id = lock_owner,
      locked_until = now() + make_interval(secs => lease_seconds)
  where lock_name = 'credentials'
    and (
      owner_id is null
      or locked_until <= now()
      or owner_id = lock_owner
    )
  returning true into acquired;

  return coalesce(acquired, false);
end;
$$;

create or replace function public.release_novapay_rotation_lock(lock_owner uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  released boolean;
begin
  update public.novapay_rotation_lock
  set owner_id = null,
      locked_until = '-infinity'::timestamptz
  where lock_name = 'credentials'
    and owner_id = lock_owner
  returning true into released;

  return coalesce(released, false);
end;
$$;

revoke all on function public.acquire_novapay_rotation_lock(uuid, integer) from public, anon, authenticated;
revoke all on function public.release_novapay_rotation_lock(uuid) from public, anon, authenticated;
grant execute on function public.acquire_novapay_rotation_lock(uuid, integer) to service_role;
grant execute on function public.release_novapay_rotation_lock(uuid) to service_role;
