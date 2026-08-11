alter table public.crm_orders
  add column if not exists internal_comment text;
