create table if not exists public.crm_reconciliations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('initial', 'reconciliation')),
  reconciled_at timestamptz not null default now(),
  usd_rate numeric not null default 0,
  accounting_usd numeric not null default 0,
  accounting_uah numeric not null default 0,
  accounting_total numeric not null default 0,
  reserve_uah numeric not null default 0,
  crm_balance_before_adjustment numeric not null,
  adjustment_uah numeric not null default 0,
  crm_balance_after_adjustment numeric not null,
  discrepancy_uah numeric not null default 0,
  cost_snapshot_uah numeric not null,
  created_at timestamptz not null default now()
);

create table if not exists public.crm_supplier_payments (
  id uuid primary key default gen_random_uuid(),
  paid_at date not null,
  amount_uah numeric not null check (amount_uah > 0),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists crm_reconciliations_created_at_idx
  on public.crm_reconciliations (created_at desc);
create index if not exists crm_supplier_payments_created_at_idx
  on public.crm_supplier_payments (created_at desc);

alter table public.crm_reconciliations enable row level security;
alter table public.crm_supplier_payments enable row level security;

create policy "crm_reconciliations_read" on public.crm_reconciliations
  for select to authenticated using (true);
create policy "crm_supplier_payments_read" on public.crm_supplier_payments
  for select to authenticated using (true);

create policy "crm_reconciliations_write" on public.crm_reconciliations
  for all to authenticated
  using ((auth.jwt() ->> 'email') <> 'guest@gmail.com')
  with check ((auth.jwt() ->> 'email') <> 'guest@gmail.com');
create policy "crm_supplier_payments_write" on public.crm_supplier_payments
  for all to authenticated
  using ((auth.jwt() ->> 'email') <> 'guest@gmail.com')
  with check ((auth.jwt() ->> 'email') <> 'guest@gmail.com');
