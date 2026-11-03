create table public.crm_kyt_usd_rate (
  id text primary key default 'USD/UAH' check (id = 'USD/UAH'),
  sell_rate numeric(12, 4) not null check (sell_rate > 0),
  fetched_at timestamptz not null,
  requested_at timestamptz not null
);

alter table public.crm_kyt_usd_rate enable row level security;

create policy "Authenticated users can read Kyt USD rate"
  on public.crm_kyt_usd_rate for select to authenticated using (true);

revoke all on public.crm_kyt_usd_rate from public, anon, authenticated;
grant select on public.crm_kyt_usd_rate to authenticated;
grant all on public.crm_kyt_usd_rate to service_role;

create function public.save_crm_kyt_usd_rate(p_rate numeric, p_requested_at timestamptz)
returns public.crm_kyt_usd_rate
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.crm_kyt_usd_rate%rowtype;
begin
  if p_rate is null or p_rate <= 0 or p_requested_at is null then
    raise exception 'Invalid Kyt USD rate';
  end if;

  insert into public.crm_kyt_usd_rate(id, sell_rate, fetched_at, requested_at)
  values ('USD/UAH', p_rate, clock_timestamp(), p_requested_at)
  on conflict (id) do update
    set sell_rate = excluded.sell_rate,
        fetched_at = excluded.fetched_at,
        requested_at = excluded.requested_at
    where public.crm_kyt_usd_rate.requested_at <= excluded.requested_at
  returning * into saved;

  if not found then
    select * into saved from public.crm_kyt_usd_rate where id = 'USD/UAH';
  end if;
  return saved;
end;
$$;

revoke all on function public.save_crm_kyt_usd_rate(numeric, timestamptz)
  from public, anon, authenticated;
grant execute on function public.save_crm_kyt_usd_rate(numeric, timestamptz)
  to service_role;
