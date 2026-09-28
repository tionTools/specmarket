-- Historical reconciliation rebaseline after the supplier-debt rule changed on 2026-09-28.
--
-- Two old orders were already reflected in the latest reconciliation snapshot under the
-- previous accounting rule, but the new current-cost RPC correctly excludes them:
--   Epicentr 57048550 / TTN 20451504365997: returned shipment, 8.10 USD cost.
--   Prom     419670585 / TTN 20451504028333: cancelled before shipment, 291.00 UAH cost.
--
-- Without rebasing the existing checkpoint, those historical costs are subtracted twice.
-- This migration changes only the latest reconciliation snapshot. It does not edit orders,
-- returns, TTNs, statuses, or the current supplier-debt rule.

do $$
declare
  v_checkpoint_id uuid;
  v_checkpoint_created_at timestamptz;
  v_snapshot_usd numeric;
  v_snapshot_uah numeric;
  v_balance_usd numeric;
  v_balance_uah numeric;
  v_current_totals jsonb;
  v_current_usd numeric;
  v_current_uah numeric;
  v_paid_usd numeric;
  v_paid_uah numeric;
  v_epicentr_usd numeric;
  v_epicentr_uah numeric;
  v_prom_usd numeric;
  v_prom_uah numeric;
  v_result_usd numeric;
  v_result_uah numeric;
begin
  select
    id,
    created_at,
    cost_snapshot_usd,
    cost_snapshot_uah,
    crm_balance_usd_after_adjustment,
    crm_balance_uah_after_adjustment
  into
    v_checkpoint_id,
    v_checkpoint_created_at,
    v_snapshot_usd,
    v_snapshot_uah,
    v_balance_usd,
    v_balance_uah
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

  v_current_totals := public.get_crm_current_cost_totals();
  v_current_usd := coalesce((v_current_totals ->> 'usd')::numeric, 0);
  v_current_uah := coalesce((v_current_totals ->> 'uah')::numeric, 0);

  if v_current_usd is distinct from numeric '1601.53'
     or v_current_uah is distinct from numeric '50215.20' then
    raise exception
      'Historical rebaseline stopped: current cost totals changed (USD %, UAH %)',
      v_current_usd,
      v_current_uah;
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
    and nullif(btrim(coalesce(o.delivery ->> 'trackingStatus', '')), '') is null;

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

  select
    coalesce(sum(debt_usd), 0),
    coalesce(sum(debt_uah), 0)
  into v_paid_usd, v_paid_uah
  from public.crm_supplier_payments
  where created_at > v_checkpoint_created_at;

  v_result_usd :=
    v_balance_usd
    + (v_current_usd - (v_snapshot_usd - v_epicentr_usd))
    - v_paid_usd;
  v_result_uah :=
    v_balance_uah
    + (v_current_uah - (v_snapshot_uah - v_prom_uah))
    - v_paid_uah;

  if v_result_usd is distinct from numeric '467.49'
     or v_result_uah is distinct from numeric '26241.22' then
    raise exception
      'Historical rebaseline stopped: resulting debt is unexpected (USD %, UAH %)',
      v_result_usd,
      v_result_uah;
  end if;
end
$$;
