-- Patch 65: the return for Prom order 419968191 was already reflected in the
-- supplier/accounting balance before the 2026-09-07 reconciliation, but the CRM
-- accepted-return row was created only afterwards. Re-baseline that one known
-- historical return in the reconciliation snapshot so accepting it does not
-- reduce supplier debt a second time.
--
-- This intentionally does not change the normal return formula. Future accepted
-- returns still reduce current supplier cost exactly once.

do $$
declare
  v_latest_reconciliation_id uuid;
  v_latest_reconciliation_created_at timestamptz;
  v_snapshot_usd numeric;
  v_snapshot_uah numeric;
  v_returned_quantity integer;
  v_item_quantity integer;
  v_item_cost_usd numeric;
  v_return_cost_usd numeric;
begin
  select
    id,
    created_at,
    cost_snapshot_usd,
    cost_snapshot_uah
  into
    v_latest_reconciliation_id,
    v_latest_reconciliation_created_at,
    v_snapshot_usd,
    v_snapshot_uah
  from public.crm_reconciliations
  where kind = 'reconciliation'
  order by created_at desc
  limit 1;

  if v_latest_reconciliation_id is distinct from '5ad8f1bf-14ee-413c-98ea-8a66c7386f54'::uuid then
    raise exception 'Patch 65 stopped: latest reconciliation changed (expected %, got %)',
      '5ad8f1bf-14ee-413c-98ea-8a66c7386f54',
      v_latest_reconciliation_id;
  end if;

  if v_latest_reconciliation_created_at is distinct from timestamptz '2026-09-07 09:34:28.656556+00' then
    raise exception 'Patch 65 stopped: reconciliation timestamp changed (got %)',
      v_latest_reconciliation_created_at;
  end if;

  if v_snapshot_usd is distinct from numeric '1094.63'
     or v_snapshot_uah is distinct from numeric '34000.2' then
    raise exception 'Patch 65 stopped: reconciliation snapshot changed (USD %, UAH %)',
      v_snapshot_usd,
      v_snapshot_uah;
  end if;

  select
    r.returned_quantity,
    i.quantity,
    i.cost_usd,
    i.cost_usd * r.returned_quantity
  into
    v_returned_quantity,
    v_item_quantity,
    v_item_cost_usd,
    v_return_cost_usd
  from public.crm_orders o
  join public.crm_order_items i
    on i.order_id = o.id
   and i.position = 0
  join public.crm_order_item_returns r
    on r.order_id = o.id
   and r.item_position = i.position
  where o.id = '7b16f029-ccd3-4571-8167-c97b98c56851'::uuid
    and o.order_number::text = '419968191'
    and o.platform = 'Пром'
    and o.status = 'canceled'
    and o.delivery ->> 'ttn' = '20451505337585'
    and r.returned_at = date '2026-09-07'
    and r.created_at = timestamptz '2026-09-07 13:59:39.145306+00'
    and r.updated_at = timestamptz '2026-09-07 13:59:39.145306+00';

  if not found then
    raise exception 'Patch 65 stopped: verified return row for order 419968191 was not found';
  end if;

  if v_returned_quantity is distinct from 14
     or v_item_quantity is distinct from 14
     or v_item_cost_usd is distinct from numeric '0.27'
     or v_return_cost_usd is distinct from numeric '3.78' then
    raise exception 'Patch 65 stopped: verified return data changed (returned %, quantity %, cost_usd %, return_cost_usd %)',
      v_returned_quantity,
      v_item_quantity,
      v_item_cost_usd,
      v_return_cost_usd;
  end if;

  update public.crm_reconciliations
  set cost_snapshot_usd = cost_snapshot_usd - v_return_cost_usd
  where id = v_latest_reconciliation_id
    and cost_snapshot_usd = numeric '1094.63'
    and cost_snapshot_uah = numeric '34000.2';

  if not found then
    raise exception 'Patch 65 stopped: reconciliation snapshot was not updated';
  end if;
end
$$;
