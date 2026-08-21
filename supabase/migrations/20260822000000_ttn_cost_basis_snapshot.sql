with checkpoint as (
  select id, reconciled_at, created_at
  from public.crm_reconciliations
  where kind = 'reconciliation'
  order by created_at desc
  limit 1
), ttn_costs as (
  select
    checkpoint.id,
    coalesce(
      sum(
        case
          when coalesce(item.cost_usd, 0) > 0
            then item.cost_usd * greatest(0, item.quantity - coalesce(item_returns.returned_quantity, 0))
          else 0
        end
      ),
      0
    ) as usd,
    coalesce(
      sum(
        case
          when coalesce(item.cost_usd, 0) <= 0
            then item.cost * greatest(0, item.quantity - coalesce(item_returns.returned_quantity, 0))
          else 0
        end
      ),
      0
    ) as uah
  from checkpoint
  join public.crm_orders as orders
    on orders.created_at <= checkpoint.reconciled_at
    and nullif(btrim(coalesce(orders.delivery ->> 'ttn', '')), '') is not null
  join public.crm_order_items as item on item.order_id = orders.id
  left join public.crm_order_item_returns as item_returns
    on item_returns.order_id = item.order_id
    and item_returns.item_position = item.position
    and item_returns.created_at <= checkpoint.created_at
  group by checkpoint.id
)
update public.crm_reconciliations as reconciliation
set
  cost_snapshot_usd = ttn_costs.usd,
  cost_snapshot_uah = ttn_costs.uah
from ttn_costs
where reconciliation.id = ttn_costs.id;
