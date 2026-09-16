create table if not exists public.bank_account_cache (
  bank text primary key check (bank in ('monobank', 'novapay')),
  balance numeric(14, 2),
  updated_at timestamptz,
  account jsonb not null default '{}'::jsonb,
  receipts jsonb not null default '[]'::jsonb,
  period_from timestamptz,
  period_to timestamptz
);

insert into public.bank_account_cache (bank)
values ('monobank'), ('novapay')
on conflict (bank) do nothing;

alter table public.bank_account_cache enable row level security;

revoke all on table public.bank_account_cache from public, anon, authenticated;
grant select on table public.bank_account_cache to authenticated;
grant all on table public.bank_account_cache to service_role;

drop policy if exists bank_account_cache_read_authenticated on public.bank_account_cache;
create policy bank_account_cache_read_authenticated
on public.bank_account_cache
for select
to authenticated
using (lower(coalesce(auth.jwt() ->> 'email', '')) <> 'guest@gmail.com');
