alter table public.crm_order_items
  add column if not exists image_url text;
