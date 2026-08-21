alter table public.crm_supplier_payments
  add column if not exists supplier_rate numeric not null default 0,
  add column if not exists debt_usd numeric not null default 0,
  add column if not exists debt_uah numeric not null default 0;
