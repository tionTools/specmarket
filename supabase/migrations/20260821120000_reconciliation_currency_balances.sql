alter table public.crm_reconciliations
  add column if not exists crm_balance_usd_before_adjustment numeric not null default 0,
  add column if not exists crm_balance_uah_before_adjustment numeric not null default 0,
  add column if not exists crm_balance_usd_after_adjustment numeric not null default 0,
  add column if not exists crm_balance_uah_after_adjustment numeric not null default 0,
  add column if not exists cost_snapshot_usd numeric not null default 0;

update public.crm_reconciliations
set
  crm_balance_uah_before_adjustment = crm_balance_before_adjustment,
  crm_balance_uah_after_adjustment = crm_balance_after_adjustment;

with cost_totals as (
  select
    coalesce(sum(case when coalesce(item.cost_usd, 0) > 0 then item.cost_usd * item.quantity else 0 end), 0) as usd,
    coalesce(sum(case when coalesce(item.cost_usd, 0) <= 0 then item.cost * item.quantity else 0 end), 0) as uah
  from public.crm_orders as orders
  join public.crm_order_items as item on item.order_id = orders.id
  where lower(orders.status) !~ '(скас|отмен|cancel|повер|возврат|return|refund)'
)
update public.crm_reconciliations
set
  cost_snapshot_usd = cost_totals.usd,
  cost_snapshot_uah = cost_totals.uah
from cost_totals;
