-- Refuse a rolling cutover while a known rotation is still in progress.
do $$
declare
  current_lock public.novapay_rotation_lock%rowtype;
begin
  select * into current_lock from public.novapay_rotation_lock
  where lock_name = 'credentials' for update;
  if current_lock.owner_id is not null and current_lock.locked_until > clock_timestamp() then
    raise exception 'NovaPay rotation is active; retry migration after it finishes';
  end if;
end;
$$;

create function public.acquire_novapay_rotation_lock_owned(lock_owner uuid, lease_seconds integer default 90)
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.acquire_novapay_rotation_lock(lock_owner, lease_seconds);
$$;

create function public.save_novapay_auth_state_owned(
  lock_owner uuid, new_refresh_token text, new_public_certificate text,
  new_jwt text, new_jwt_expires_at text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_lock public.novapay_rotation_lock%rowtype;
begin
  -- Serialize ownership validation and the entire save with lock acquisition.
  select * into current_lock from public.novapay_rotation_lock
  where lock_name = 'credentials' for update;
  if lock_owner is null or current_lock.owner_id is distinct from lock_owner
     or current_lock.locked_until is null or current_lock.locked_until <= clock_timestamp() then
    raise exception using errcode = 'NP001', message = 'NovaPay authorization lock lost';
  end if;
  perform public.save_novapay_auth_state(new_refresh_token, new_public_certificate, new_jwt, new_jwt_expires_at);
end;
$$;

revoke all on function public.acquire_novapay_rotation_lock_owned(uuid, integer) from public, anon, authenticated;
revoke all on function public.save_novapay_auth_state_owned(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.acquire_novapay_rotation_lock_owned(uuid, integer) to service_role;
grant execute on function public.save_novapay_auth_state_owned(uuid, text, text, text, text) to service_role;

-- Old deployments must fail before contacting NovaPay, not rotate then fail to save.
revoke all on function public.acquire_novapay_rotation_lock(uuid, integer) from service_role;
revoke all on function public.save_novapay_auth_state(text, text, text, text) from service_role;

notify pgrst, 'reload schema';
