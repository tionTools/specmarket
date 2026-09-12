alter table public.crm_reconciliations
  add column if not exists adjustment_usd numeric not null default 0;
