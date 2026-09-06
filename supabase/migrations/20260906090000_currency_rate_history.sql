create table if not exists public.crm_currency_rates (
  currency text not null default 'USD' check (currency = 'USD'),
  effective_from date not null,
  rate numeric not null check (rate > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (currency, effective_from)
);

insert into public.crm_currency_rates (currency, effective_from, rate)
select 'USD', date '2000-01-01', numeric_value
from public.crm_settings
where key = 'usd_rate'
  and numeric_value is not null
  and numeric_value > 0
on conflict (currency, effective_from) do nothing;

alter table public.crm_currency_rates enable row level security;

create policy "crm_currency_rates_read" on public.crm_currency_rates
  for select to authenticated using (true);

create policy "crm_currency_rates_write" on public.crm_currency_rates
  for all to authenticated
  using ((auth.jwt() ->> 'email') <> 'guest@gmail.com')
  with check ((auth.jwt() ->> 'email') <> 'guest@gmail.com');
