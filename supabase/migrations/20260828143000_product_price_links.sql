alter table public.crm_order_items
  add column if not exists marketplace_product_key text,
  add column if not exists cost_manual boolean not null default false,
  add column if not exists price_item_id uuid references public.crm_price_items(id) on delete set null;

create index if not exists crm_order_items_marketplace_product_key_idx
  on public.crm_order_items (marketplace_product_key);
create index if not exists crm_order_items_price_item_id_idx
  on public.crm_order_items (price_item_id);

create table if not exists public.crm_product_price_links (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('Пром', 'Эпицентр', 'Каста')),
  marketplace_product_key text not null,
  price_item_id uuid not null references public.crm_price_items(id) on delete cascade,
  product_title text,
  size text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, marketplace_product_key)
);

create index if not exists crm_product_price_links_price_item_id_idx
  on public.crm_product_price_links (price_item_id);

alter table public.crm_product_price_links enable row level security;

create policy "crm_product_price_links_read" on public.crm_product_price_links
  for select to authenticated using (true);

create policy "crm_product_price_links_write" on public.crm_product_price_links
  for all to authenticated
  using ((auth.jwt() ->> 'email') <> 'guest@gmail.com')
  with check ((auth.jwt() ->> 'email') <> 'guest@gmail.com');
