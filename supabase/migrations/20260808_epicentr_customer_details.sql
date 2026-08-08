alter table public.crm_orders
  add column if not exists customer_email text,
  add column if not exists customer_comment text;
