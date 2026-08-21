with printed_costs as (
  select
    reconciliation.id,
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
  from public.crm_reconciliations as reconciliation
  left join public.crm_orders as orders
    on nullif(orders.delivery ->> 'printedAt', '') is not null
    and (orders.delivery ->> 'printedAt')::timestamptz <= reconciliation.reconciled_at
  left join public.crm_order_items as item on item.order_id = orders.id
  left join public.crm_order_item_returns as item_returns
    on item_returns.order_id = item.order_id
    and item_returns.item_position = item.position
    and item_returns.created_at <= reconciliation.created_at
  where reconciliation.kind = 'reconciliation'
  group by reconciliation.id
)
update public.crm_reconciliations as reconciliation
set
  cost_snapshot_usd = printed_costs.usd,
  cost_snapshot_uah = printed_costs.uah
from printed_costs
where reconciliation.id = printed_costs.id;
