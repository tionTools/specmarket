-- Shared marketplace switch. Existing schedules stay intact; the due gate prevents
-- disabled marketplaces from invoking Edge Functions, and Edge repeats the check.
create table public.crm_marketplace_settings (
  platform text primary key check (platform in ('Пром', 'Эпицентр', 'Каста')),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.crm_marketplace_settings enable row level security;

revoke all on public.crm_marketplace_settings from public, anon, authenticated;
grant select, insert, update on public.crm_marketplace_settings to authenticated;
grant all on public.crm_marketplace_settings to service_role;
grant select on public.crm_marketplace_settings to postgres;

create policy crm_marketplace_settings_read
on public.crm_marketplace_settings for select to authenticated using (true);

create policy crm_marketplace_settings_insert
on public.crm_marketplace_settings for insert to authenticated
with check (auth.uid() is not null and lower(coalesce(auth.jwt() ->> 'email', '')) <> 'guest@gmail.com');

create policy crm_marketplace_settings_update
on public.crm_marketplace_settings for update to authenticated
using (auth.uid() is not null and lower(coalesce(auth.jwt() ->> 'email', '')) <> 'guest@gmail.com')
with check (auth.uid() is not null and lower(coalesce(auth.jwt() ->> 'email', '')) <> 'guest@gmail.com');

insert into public.crm_marketplace_settings (platform, enabled)
values ('Пром', true), ('Эпицентр', true), ('Каста', true)
on conflict (platform) do nothing;

-- One RPC instead of separate secret and settings reads on every Edge invocation.
-- This value contains a credential and must never be callable from the browser.
create function public.get_crm_marketplace_sync_access(p_platform text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'secret', (
      select decrypted_secret from vault.decrypted_secrets
      where name = 'crm_sync_cron_secret' limit 1
    ),
    'enabled', coalesce((
      select enabled from public.crm_marketplace_settings
      where platform = p_platform
    ), false)
  );
$$;
revoke all on function public.get_crm_marketplace_sync_access(text) from public, anon, authenticated;
grant execute on function public.get_crm_marketplace_sync_access(text) to service_role;

-- Preserve both existing signatures, offsets and Kyiv day/night timetable.
-- Changing the setting takes effect on the next cron due check without rescheduling.
create or replace function public.crm_marketplace_sync_is_due(platform text, at_time timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  with local_time as (
    select at_time at time zone 'Europe/Kyiv' as value
  ), offsets as (
    select case platform
      when 'Пром' then 0
      when 'Эпицентр' then 1
      when 'Каста' then 2
      else -1
    end as value
  )
  select exists (
    select 1 from public.crm_marketplace_settings s
    where s.platform = $1 and s.enabled
  ) and offsets.value >= 0 and case
    when extract(hour from local_time.value) between 7 and 23
      then extract(minute from local_time.value)::int % 5 = offsets.value
    else extract(minute from local_time.value)::int = offsets.value
  end
  from local_time, offsets;
$$;
