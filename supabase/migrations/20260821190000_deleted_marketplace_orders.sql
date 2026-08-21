create table public.crm_deleted_marketplace_orders (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  external_id text not null,
  order_label text,
  deleted_at timestamptz not null default now(),
  unique (platform, external_id)
);

alter table public.crm_deleted_marketplace_orders enable row level security;

create policy "crm_deleted_marketplace_orders_read" on public.crm_deleted_marketplace_orders
  for select to authenticated using (true);

create policy "crm_deleted_marketplace_orders_write" on public.crm_deleted_marketplace_orders
  for all to authenticated
  using ((auth.jwt() ->> 'email') <> 'guest@gmail.com')
  with check ((auth.jwt() ->> 'email') <> 'guest@gmail.com');
