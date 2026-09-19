alter table public.novapay_rotation_lock
  add column novapay_auth_uncertain boolean not null default false,
  add column recovery_pair_fingerprint text;

-- Do not install the guard halfway through an existing rotation.
do $$
begin
  if exists (select 1 from public.novapay_rotation_lock
             where lock_name = 'credentials' and owner_id is not null
               and locked_until > clock_timestamp()) then
    raise exception 'NovaPay rotation is active; retry migration after it finishes';
  end if;
end;
$$;

alter function public.get_novapay_auth_state() rename to get_novapay_auth_state_credentials;
revoke all on function public.get_novapay_auth_state_credentials() from public, anon, authenticated, service_role;

create function public.get_novapay_auth_state()
returns jsonb language sql security definer set search_path = public as $$
  select public.get_novapay_auth_state_credentials() || jsonb_build_object(
    'novapay_auth_uncertain', coalesce((select novapay_auth_uncertain
      from public.novapay_rotation_lock where lock_name = 'credentials'), true));
$$;
revoke all on function public.get_novapay_auth_state() from public, anon, authenticated;
grant execute on function public.get_novapay_auth_state() to service_role;

-- Also block older deployed helpers during the migration -> deploy transition.
create or replace function public.acquire_novapay_rotation_lock_owned(lock_owner uuid, lease_seconds integer default 90)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  current_lock public.novapay_rotation_lock%rowtype;
begin
  select * into current_lock from public.novapay_rotation_lock
    where lock_name = 'credentials' for update;
  -- A live owner may still finish successfully; contenders keep their bounded wait.
  if current_lock.novapay_auth_uncertain
     and (current_lock.owner_id is null or current_lock.locked_until <= clock_timestamp()) then
    raise exception using errcode = 'NP002', message = 'NovaPay authorization recovery required';
  end if;
  return public.acquire_novapay_rotation_lock(lock_owner, lease_seconds);
end;
$$;

create function public.begin_novapay_auth_rotation(lock_owner uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  current_lock public.novapay_rotation_lock%rowtype;
  auth_state jsonb;
begin
  select * into current_lock from public.novapay_rotation_lock
    where lock_name = 'credentials' for update;
  if lock_owner is null or current_lock.owner_id is distinct from lock_owner
     or current_lock.locked_until is null or current_lock.locked_until <= clock_timestamp() then
    raise exception using errcode = 'NP001', message = 'NovaPay authorization lock lost';
  end if;
  if current_lock.novapay_auth_uncertain then
    raise exception using errcode = 'NP002', message = 'NovaPay authorization recovery required';
  end if;
  auth_state := public.get_novapay_auth_state_credentials();
  update public.novapay_rotation_lock
    set novapay_auth_uncertain = true,
        recovery_pair_fingerprint = md5(jsonb_build_array(
          btrim(auth_state->>'refresh_token'), btrim(auth_state->>'public_certificate'))::text)
    where lock_name = 'credentials';
end;
$$;
revoke all on function public.begin_novapay_auth_rotation(uuid) from public, anon, authenticated;
grant execute on function public.begin_novapay_auth_rotation(uuid) to service_role;

create or replace function public.save_novapay_auth_state_owned(
  lock_owner uuid, new_refresh_token text, new_public_certificate text,
  new_jwt text, new_jwt_expires_at text
)
returns void language plpgsql security definer set search_path = public as $$
declare
  current_lock public.novapay_rotation_lock%rowtype;
begin
  select * into current_lock from public.novapay_rotation_lock
    where lock_name = 'credentials' for update;
  if lock_owner is null or current_lock.owner_id is distinct from lock_owner
     or current_lock.locked_until is null or current_lock.locked_until <= clock_timestamp() then
    raise exception using errcode = 'NP001', message = 'NovaPay authorization lock lost';
  end if;
  perform public.save_novapay_auth_state(new_refresh_token, new_public_certificate, new_jwt, new_jwt_expires_at);
  update public.novapay_rotation_lock
    set novapay_auth_uncertain = false, recovery_pair_fingerprint = null
    where lock_name = 'credentials';
end;
$$;

-- Administrator-only recovery AFTER replacing the pair manually. Does not modify Vault.
create function public.reset_novapay_auth_uncertain()
returns void language plpgsql security definer set search_path = public as $$
declare
  current_lock public.novapay_rotation_lock%rowtype;
  auth_state jsonb;
  pair_fingerprint text;
begin
  select * into current_lock from public.novapay_rotation_lock
    where lock_name = 'credentials' for update;
  if not found then raise exception 'NovaPay lock state missing'; end if;
  if current_lock.owner_id is not null and current_lock.locked_until > clock_timestamp() then
    raise exception 'NovaPay rotation is active; wait before manual recovery';
  end if;
  if not current_lock.novapay_auth_uncertain then return; end if;
  auth_state := public.get_novapay_auth_state_credentials();
  if nullif(btrim(auth_state->>'refresh_token'), '') is null
     or nullif(btrim(auth_state->>'public_certificate'), '') is null then
    raise exception 'Install a fresh non-empty NovaPay credential pair first';
  end if;
  pair_fingerprint := md5(jsonb_build_array(
    btrim(auth_state->>'refresh_token'), btrim(auth_state->>'public_certificate'))::text);
  if current_lock.recovery_pair_fingerprint is null
     or pair_fingerprint = current_lock.recovery_pair_fingerprint then
    raise exception 'Replace the uncertain NovaPay credential pair before reset';
  end if;
  update public.novapay_rotation_lock
    set novapay_auth_uncertain = false, recovery_pair_fingerprint = null
    where lock_name = 'credentials';
end;
$$;
revoke all on function public.reset_novapay_auth_uncertain() from public, anon, authenticated, service_role;
grant execute on function public.reset_novapay_auth_uncertain() to postgres;

notify pgrst, 'reload schema';
