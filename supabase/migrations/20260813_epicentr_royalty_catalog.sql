create table if not exists public.crm_epicentr_royalty_categories (
  id uuid primary key default gen_random_uuid(),
  title text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.crm_epicentr_royalty_rates (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.crm_epicentr_royalty_categories(id) on delete cascade,
  effective_from date not null,
  royalty_percent numeric(6,2) not null check (royalty_percent >= 0 and royalty_percent <= 100),
  unique (category_id, effective_from)
);

create table if not exists public.crm_epicentr_product_categories (
  offer_id text primary key,
  product_title text not null,
  category_id uuid references public.crm_epicentr_royalty_categories(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.crm_epicentr_royalty_categories enable row level security;
alter table public.crm_epicentr_royalty_rates enable row level security;
alter table public.crm_epicentr_product_categories enable row level security;

create policy "crm_epicentr_royalty_categories_read" on public.crm_epicentr_royalty_categories for select to authenticated using (true);
create policy "crm_epicentr_royalty_rates_read" on public.crm_epicentr_royalty_rates for select to authenticated using (true);
create policy "crm_epicentr_product_categories_read" on public.crm_epicentr_product_categories for select to authenticated using (true);

create policy "crm_epicentr_royalty_categories_write" on public.crm_epicentr_royalty_categories for all to authenticated using ((auth.jwt() ->> 'email') <> 'guest@gmail.com') with check ((auth.jwt() ->> 'email') <> 'guest@gmail.com');
create policy "crm_epicentr_royalty_rates_write" on public.crm_epicentr_royalty_rates for all to authenticated using ((auth.jwt() ->> 'email') <> 'guest@gmail.com') with check ((auth.jwt() ->> 'email') <> 'guest@gmail.com');
create policy "crm_epicentr_product_categories_write" on public.crm_epicentr_product_categories for all to authenticated using ((auth.jwt() ->> 'email') <> 'guest@gmail.com') with check ((auth.jwt() ->> 'email') <> 'guest@gmail.com');

insert into public.crm_epicentr_royalty_categories (title)
values
  ('Наколінники будівельні'), ('Рукавиці робочі'), ('Спецвзуття'), ('Спецодяг'),
  ('Світловідбиваючі жилети'), ('Гумові чоботи'), ('Рукавички зимові'),
  ('Дощовики і пончо туристичні'), ('Сабо')
on conflict (title) do nothing;

insert into public.crm_epicentr_royalty_rates (category_id, effective_from, royalty_percent)
select id, date '2026-08-01', case title
  when 'Наколінники будівельні' then 13
  when 'Рукавиці робочі' then 13
  when 'Спецвзуття' then 13
  when 'Спецодяг' then 13
  when 'Світловідбиваючі жилети' then 12
  else 15
end
from public.crm_epicentr_royalty_categories
on conflict (category_id, effective_from) do nothing;
