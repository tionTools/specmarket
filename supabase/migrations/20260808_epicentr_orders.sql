alter table public.crm_orders
  add column if not exists external_id text;

create unique index if not exists crm_orders_external_id_unique
  on public.crm_orders (external_id)
  where external_id is not null;
