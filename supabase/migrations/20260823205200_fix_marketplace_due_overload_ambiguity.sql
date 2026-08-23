-- Fix marketplace polling blocked by an ambiguous overloaded function call.
--
-- Production has both:
--   crm_marketplace_sync_is_due(text)
--   crm_marketplace_sync_is_due(text, timestamptz DEFAULT now())
--
-- Cron calls crm_marketplace_sync_is_due('Пром') / ('Эпицентр') / ('Каста').
-- The string literal has type unknown, and because the two-argument overload has
-- a default for at_time, PostgreSQL cannot choose a unique one-argument call.
--
-- Keep both signatures, but remove DEFAULT from the two-argument helper. Then
-- every one-argument call resolves uniquely to the compatibility wrapper, while
-- fixed-timestamp tests can still call the two-argument helper explicitly.

-- PostgreSQL cannot remove defaults through CREATE OR REPLACE.
drop function public.crm_marketplace_sync_is_due(text, timestamptz);

create or replace function public.crm_marketplace_sync_is_due(
  platform text,
  at_time timestamptz
)
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
  select offsets.value >= 0 and case
    when extract(hour from local_time.value) between 7 and 23
      then extract(minute from local_time.value)::int % 5 = offsets.value
    else extract(minute from local_time.value)::int = offsets.value
  end
  from local_time, offsets;
$$;

create or replace function public.crm_marketplace_sync_is_due(platform text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.crm_marketplace_sync_is_due(
    case lower(platform)
      when 'prom' then 'Пром'
      when 'epicentr' then 'Эпицентр'
      when 'kasta' then 'Каста'
      else platform
    end,
    now()
  );
$$;

revoke all on function public.crm_marketplace_sync_is_due(text) from public, anon, authenticated;
grant execute on function public.crm_marketplace_sync_is_due(text) to postgres;
