create table if not exists public.crm_marketplace_product_families (
  platform text not null check (platform in ('Пром', 'Эпицентр')),
  marketplace_product_key text not null,
  family_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (platform, marketplace_product_key)
);

create index if not exists crm_marketplace_product_families_family_idx
  on public.crm_marketplace_product_families (platform, family_key);

alter table public.crm_marketplace_product_families enable row level security;

create policy "crm_marketplace_product_families_read" on public.crm_marketplace_product_families
  for select to authenticated using (true);

create policy "crm_marketplace_product_families_write" on public.crm_marketplace_product_families
  for all to authenticated
  using ((auth.jwt() ->> 'email') <> 'guest@gmail.com')
  with check ((auth.jwt() ->> 'email') <> 'guest@gmail.com');
