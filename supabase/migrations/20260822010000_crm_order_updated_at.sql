alter table public.crm_orders
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.touch_crm_order_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists crm_orders_touch_updated_at on public.crm_orders;
create trigger crm_orders_touch_updated_at
before insert or update on public.crm_orders
for each row execute function public.touch_crm_order_updated_at();

create or replace function public.touch_parent_crm_order_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.crm_orders
     set updated_at = now()
   where id in (old.order_id, new.order_id);
  return coalesce(new, old);
end;
$$;

drop trigger if exists crm_order_items_touch_parent_updated_at on public.crm_order_items;
create trigger crm_order_items_touch_parent_updated_at
after insert or update or delete on public.crm_order_items
for each row execute function public.touch_parent_crm_order_updated_at();

drop trigger if exists crm_order_item_returns_touch_parent_updated_at on public.crm_order_item_returns;
create trigger crm_order_item_returns_touch_parent_updated_at
after insert or update or delete on public.crm_order_item_returns
for each row execute function public.touch_parent_crm_order_updated_at();
