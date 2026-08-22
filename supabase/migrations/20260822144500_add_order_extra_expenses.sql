alter table public.crm_orders
  add column if not exists extra_expenses numeric not null default 0;
