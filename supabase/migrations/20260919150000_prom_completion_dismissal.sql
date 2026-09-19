alter table public.crm_orders
  add column if not exists prom_completion_dismissed_at timestamptz;
