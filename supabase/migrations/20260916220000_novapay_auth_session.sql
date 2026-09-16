do $$
declare
  matched integer;
begin
  select count(*) into matched from vault.secrets where name = 'novapay_refresh_token';
  if matched <> 1 then raise exception 'Expected exactly one novapay_refresh_token, found %', matched; end if;
  select count(*) into matched from vault.secrets where name = 'novapay_public_certificate';
  if matched <> 1 then raise exception 'Expected exactly one novapay_public_certificate, found %', matched; end if;

  select count(*) into matched from vault.secrets where name = 'novapay_jwt';
  if matched > 1 then raise exception 'Expected at most one novapay_jwt, found %', matched; end if;
  if matched = 0 then perform vault.create_secret('', 'novapay_jwt'); end if;
  select count(*) into matched from vault.secrets where name = 'novapay_jwt_expires_at';
  if matched > 1 then raise exception 'Expected at most one novapay_jwt_expires_at, found %', matched; end if;
  if matched = 0 then perform vault.create_secret('', 'novapay_jwt_expires_at'); end if;
end;
$$;

create or replace function public.get_novapay_auth_state()
returns jsonb
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  refresh_token text;
  public_certificate text;
  jwt text;
  jwt_expires_at text;
  matched integer;
begin
  select count(*) into matched from vault.secrets where name = 'novapay_refresh_token';
  if matched <> 1 then raise exception 'Expected exactly one novapay_refresh_token, found %', matched; end if;
  select count(*) into matched from vault.secrets where name = 'novapay_public_certificate';
  if matched <> 1 then raise exception 'Expected exactly one novapay_public_certificate, found %', matched; end if;

  select decrypted_secret into refresh_token from vault.decrypted_secrets where name = 'novapay_refresh_token';
  select decrypted_secret into public_certificate from vault.decrypted_secrets where name = 'novapay_public_certificate';
  select count(*) into matched from vault.secrets where name = 'novapay_jwt';
  if matched <> 1 then raise exception 'Expected exactly one novapay_jwt, found %', matched; end if;
  select decrypted_secret into jwt from vault.decrypted_secrets where name = 'novapay_jwt';
  select count(*) into matched from vault.secrets where name = 'novapay_jwt_expires_at';
  if matched <> 1 then raise exception 'Expected exactly one novapay_jwt_expires_at, found %', matched; end if;
  select decrypted_secret into jwt_expires_at from vault.decrypted_secrets where name = 'novapay_jwt_expires_at';
  return jsonb_build_object('refresh_token', refresh_token, 'public_certificate', public_certificate, 'jwt', jwt, 'jwt_expires_at', jwt_expires_at);
end;
$$;

create or replace function public.save_novapay_auth_state(new_refresh_token text, new_public_certificate text, new_jwt text, new_jwt_expires_at text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  secret_name text;
  secret_value text;
  secret_id uuid;
  matched integer;
begin
  if nullif(btrim(new_refresh_token), '') is null or nullif(btrim(new_public_certificate), '') is null or nullif(btrim(new_jwt), '') is null then
    raise exception 'NovaPay refresh token, public certificate, and JWT must be non-empty';
  end if;
  if new_jwt_expires_at is null or (new_jwt_expires_at <> '' and new_jwt_expires_at !~ '^[0-9]+$') then
    raise exception 'NovaPay JWT expiry must be empty or a Unix timestamp';
  end if;
  for secret_name, secret_value in select * from (values
    ('novapay_refresh_token'::text, new_refresh_token),
    ('novapay_public_certificate'::text, new_public_certificate),
    ('novapay_jwt'::text, new_jwt),
    ('novapay_jwt_expires_at'::text, new_jwt_expires_at)
  ) as state(name, value) loop
    select count(*), (array_agg(id))[1] into matched, secret_id from vault.secrets where name = secret_name;
    if matched <> 1 then
      raise exception 'Expected exactly one Vault secret %, found %', secret_name, matched;
    end if;
    perform vault.update_secret(secret_id, secret_value);
  end loop;
end;
$$;

revoke all on function public.get_novapay_auth_state() from public, anon, authenticated;
revoke all on function public.save_novapay_auth_state(text, text, text, text) from public, anon, authenticated;
grant execute on function public.get_novapay_auth_state() to service_role;
grant execute on function public.save_novapay_auth_state(text, text, text, text) to service_role;
