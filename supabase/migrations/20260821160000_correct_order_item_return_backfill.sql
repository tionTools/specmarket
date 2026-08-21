with initial as (
  select id, reconciled_at
  from public.crm_reconciliations
  where kind = 'initial'
  order by created_at
  limit 1
), auto_returns as (
  select returns.*
  from public.crm_order_item_returns as returns
  where returns.created_at = timestamptz '2026-08-21 12:49:17.471864+00'
    and returns.updated_at = timestamptz '2026-08-21 12:49:17.471864+00'
    and returns.returned_at = date '2026-08-21'
), before_initial as (
  select returns.*
  from auto_returns as returns
  join public.crm_orders as orders on orders.id = returns.order_id
  cross join initial
  where orders.created_at < initial.reconciled_at
), return_costs as (
  select
    coalesce(sum(case when coalesce(items.cost_usd, 0) > 0 then items.cost_usd * returns.returned_quantity else 0 end), 0) as usd,
    coalesce(sum(case when coalesce(items.cost_usd, 0) <= 0 then items.cost * returns.returned_quantity else 0 end), 0) as uah
  from before_initial as returns
  join public.crm_order_items as items
    on items.order_id = returns.order_id
   and items.position = returns.item_position
   and items.product_name = returns.product_name
)
update public.crm_reconciliations as reconciliation
set
  cost_snapshot_usd = reconciliation.cost_snapshot_usd + return_costs.usd,
  cost_snapshot_uah = reconciliation.cost_snapshot_uah + return_costs.uah
from initial, return_costs
where reconciliation.id = initial.id;

delete from public.crm_order_item_returns
where created_at = timestamptz '2026-08-21 12:49:17.471864+00'
  and updated_at = timestamptz '2026-08-21 12:49:17.471864+00'
  and returned_at = date '2026-08-21';
