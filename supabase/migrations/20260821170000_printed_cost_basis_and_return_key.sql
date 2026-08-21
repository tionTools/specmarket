alter table public.crm_order_item_returns
  drop constraint crm_order_item_returns_order_id_item_position_product_name_key,
  add constraint crm_order_item_returns_order_id_item_position_key unique (order_id, item_position);

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
     and position = new.item_position;

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

with initial as (
  select id, reconciled_at
  from public.crm_reconciliations
  where kind = 'initial'
  order by created_at
  limit 1
), initial_costs as (
  select
    coalesce(sum(case when coalesce(items.cost_usd, 0) > 0 then items.cost_usd * greatest(0, items.quantity - coalesce(item_returns.returned_quantity, 0)) else 0 end), 0) as usd,
    coalesce(sum(case when coalesce(items.cost_usd, 0) <= 0 then items.cost * greatest(0, items.quantity - coalesce(item_returns.returned_quantity, 0)) else 0 end), 0) as uah
  from public.crm_orders as orders
  join public.crm_order_items as items on items.order_id = orders.id
  left join public.crm_order_item_returns as item_returns
    on item_returns.order_id = items.order_id
   and item_returns.item_position = items.position
  cross join initial
  where nullif(orders.delivery ->> 'printedAt', '') is not null
    and (orders.delivery ->> 'printedAt')::timestamptz <= initial.reconciled_at
)
update public.crm_reconciliations as reconciliation
set
  cost_snapshot_usd = initial_costs.usd,
  cost_snapshot_uah = initial_costs.uah
from initial, initial_costs
where reconciliation.id = initial.id;
