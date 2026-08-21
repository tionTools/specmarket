create table if not exists public.crm_order_item_returns (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.crm_orders(id) on delete cascade,
  item_position integer not null check (item_position >= 0),
  product_name text not null,
  returned_quantity integer not null default 0 check (returned_quantity >= 0),
  returned_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, item_position, product_name)
);

create or replace function public.validate_crm_order_item_return()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  source_quantity integer;
begin
  select quantity
    into source_quantity
    from public.crm_order_items
   where order_id = new.order_id
     and position = new.item_position
     and product_name = new.product_name;

  if source_quantity is null then
    raise exception 'Исходная позиция заказа не найдена';
  end if;
  if new.returned_quantity > source_quantity then
    raise exception 'Количество возврата больше количества позиции';
  end if;

  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists crm_order_item_returns_validate on public.crm_order_item_returns;
create trigger crm_order_item_returns_validate
before insert or update on public.crm_order_item_returns
for each row execute function public.validate_crm_order_item_return();

alter table public.crm_order_item_returns enable row level security;

create policy "crm_order_item_returns_read" on public.crm_order_item_returns
  for select to authenticated using (true);
create policy "crm_order_item_returns_write" on public.crm_order_item_returns
  for all to authenticated
  using ((auth.jwt() ->> 'email') <> 'guest@gmail.com')
  with check ((auth.jwt() ->> 'email') <> 'guest@gmail.com');

insert into public.crm_order_item_returns (
  order_id,
  item_position,
  product_name,
  returned_quantity,
  returned_at
)
select
  item.order_id,
  item.position,
  item.product_name,
  item.quantity,
  current_date
from public.crm_orders as orders
join public.crm_order_items as item on item.order_id = orders.id
where lower(orders.status) ~ '(повер|возврат|return|refund)'
on conflict (order_id, item_position, product_name) do update
set returned_quantity = greatest(
  public.crm_order_item_returns.returned_quantity,
  excluded.returned_quantity
);
