alter table public.crm_order_items
  add column if not exists cost_usd numeric not null default 0;
