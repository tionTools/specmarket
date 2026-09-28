-- Rebaseline the latest reconciliation after the supplier-debt rule changed on 2026-09-28.
--
-- These two historical orders were already reflected in the saved checkpoint under the
-- previous rule, but the current supplier-debt RPC now correctly excludes them:
--   Epicentr 57048550 / TTN 20451504365997: returned shipment, 8.10 USD cost.
--   Prom     419670585 / TTN 20451504028333: cancelled before shipment, 291.00 UAH cost.
--
-- Without rebasing the checkpoint, both historical costs are subtracted a second time.
-- This migration changes only the latest reconciliation cost snapshot. It does not edit
-- orders, returns, TTNs, statuses, payments, or the current supplier-debt rule.

do $$
declare
  v_checkpoint_id uuid;
  v_snapshot_usd numeric;
  v_snapshot_uah numeric;
  v_epicentr_usd numeric;
  v_epicentr_uah numeric;
  v_prom_usd numeric;
  v_prom_uah numeric;
begin
  select
    id,
    cost_snapshot_usd,
    cost_snapshot_uah
  into
    v_checkpoint_id,
    v_snapshot_usd,
    v_snapshot_uah
  from public.crm_reconciliations
  where kind = 'reconciliation'
  order by created_at desc
  limit 1;

  if v_checkpoint_id is null then
    raise exception 'Historical rebaseline stopped: latest reconciliation not found';
  end if;

  if v_snapshot_usd is distinct from numeric '1603.60'
     or v_snapshot_uah is distinct from numeric '50131.20' then
    raise exception
      'Historical rebaseline stopped: checkpoint snapshot changed (USD %, UAH %)',
      v_snapshot_usd,
      v_snapshot_uah;
  end if;

  select
    coalesce(sum(case when i.cost_usd > 0
      then i.cost_usd * greatest(0, i.quantity - coalesce(r.returned_quantity, 0))
      else 0 end), 0),
    coalesce(sum(case when i.cost_usd > 0
      then 0
      else i.cost * greatest(0, i.quantity - coalesce(r.returned_quantity, 0))
      end), 0)
  into v_epicentr_usd, v_epicentr_uah
  from public.crm_orders o
  join public.crm_order_items i on i.order_id = o.id
  left join public.crm_order_item_returns r
    on r.order_id = i.order_id
    and r.item_position = i.position
  where o.order_number::text = '57048550'
    and o.platform = 'Эпицентр'
    and o.delivery ->> 'ttn' = '20451504365997'
    and lower(coalesce(o.status, '')) ~ '(скас|отмен|cancel)'
    and lower(coalesce(o.delivery ->> 'trackingStatus', '')) ~ '(отрим|получ|достав|вручен)';

  if v_epicentr_usd is distinct from numeric '8.10'
     or v_epicentr_uah is distinct from numeric '0' then
    raise exception
      'Historical rebaseline stopped: Epicentr 57048550 contribution changed (USD %, UAH %)',
      v_epicentr_usd,
      v_epicentr_uah;
  end if;

  select
    coalesce(sum(case when i.cost_usd > 0
      then i.cost_usd * greatest(0, i.quantity - coalesce(r.returned_quantity, 0))
      else 0 end), 0),
    coalesce(sum(case when i.cost_usd > 0
      then 0
      else i.cost * greatest(0, i.quantity - coalesce(r.returned_quantity, 0))
      end), 0)
  into v_prom_usd, v_prom_uah
  from public.crm_orders o
  join public.crm_order_items i on i.order_id = o.id
  left join public.crm_order_item_returns r
    on r.order_id = i.order_id
    and r.item_position = i.position
  where o.order_number::text = '419670585'
    and o.platform = 'Пром'
    and o.delivery ->> 'ttn' = '20451504028333'
    and lower(coalesce(o.status, '')) ~ '(скас|отмен|cancel)'
    and nullif(btrim(coalesce(o.delivery ->> 'printedAt', '')), '') is null
    and lower(btrim(coalesce(o.delivery ->> 'trackingStatus', ''))) ~ '(видален|удален|deleted)'
    and lower(btrim(coalesce(o.delivery ->> 'trackingNormalizedStatus', ''))) = 'deleted';

  if v_prom_usd is distinct from numeric '0'
     or v_prom_uah is distinct from numeric '291.00' then
    raise exception
      'Historical rebaseline stopped: Prom 419670585 contribution changed (USD %, UAH %)',
      v_prom_usd,
      v_prom_uah;
  end if;

  update public.crm_reconciliations
  set
    cost_snapshot_usd = cost_snapshot_usd - v_epicentr_usd,
    cost_snapshot_uah = cost_snapshot_uah - v_prom_uah
  where id = v_checkpoint_id
    and cost_snapshot_usd = numeric '1603.60'
    and cost_snapshot_uah = numeric '50131.20';

  if not found then
    raise exception 'Historical rebaseline stopped: guarded checkpoint update did not apply';
  end if;
end
$$;
