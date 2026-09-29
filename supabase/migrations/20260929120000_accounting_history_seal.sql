-- Patch 165: seal already reconciled supplier-cost history.
--
-- This migration is inert until public.seal_crm_accounting_history() is called.
-- Before the seal, get_crm_current_cost_totals() stays equivalent to the current
-- production rule, including the carrier-deleted-TTN exclusion.
--
-- The seal freezes historical accounting at the latest reconciliation while
-- keeping truly future, not-yet-shipped active orders live.

create table if not exists public.crm_accounting_history_lock (
  id smallint primary key default 1 check (id = 1),
  reconciliation_id uuid not null unique
    references public.crm_reconciliations(id) on delete restrict,
  reconciled_at timestamptz not null,
  reconciliation_date date not null,
  sealed_at timestamptz not null,
  cost_snapshot_usd numeric not null,
  cost_snapshot_uah numeric not null
);

create table if not exists public.crm_accounting_history_lock_orders (
  lock_id smallint not null default 1
    references public.crm_accounting_history_lock(id) on delete restrict,
  order_id uuid not null,
  included_at_seal boolean not null,
  primary key (lock_id, order_id)
);

create table if not exists public.crm_accounting_history_lock_items (
  lock_id smallint not null default 1,
  order_id uuid not null,
  item_position integer not null,
  product_name text not null,
  quantity numeric not null check (quantity >= 0),
  returned_quantity_at_seal numeric not null check (returned_quantity_at_seal >= 0),
  cost numeric not null,
  cost_usd numeric not null,
  primary key (lock_id, order_id, item_position),
  foreign key (lock_id, order_id)
    references public.crm_accounting_history_lock_orders(lock_id, order_id)
    on delete restrict
);

alter table public.crm_accounting_history_lock enable row level security;
alter table public.crm_accounting_history_lock_orders enable row level security;
alter table public.crm_accounting_history_lock_items enable row level security;

revoke all on table public.crm_accounting_history_lock
from public, anon, authenticated;
revoke all on table public.crm_accounting_history_lock_orders
from public, anon, authenticated;
revoke all on table public.crm_accounting_history_lock_items
from public, anon, authenticated;

grant select on table public.crm_accounting_history_lock to service_role;
grant select on table public.crm_accounting_history_lock_orders to service_role;
grant select on table public.crm_accounting_history_lock_items to service_role;

create policy crm_accounting_history_lock_service_read
  on public.crm_accounting_history_lock
  for select to service_role using (true);

create policy crm_accounting_history_lock_orders_service_read
  on public.crm_accounting_history_lock_orders
  for select to service_role using (true);

create policy crm_accounting_history_lock_items_service_read
  on public.crm_accounting_history_lock_items
  for select to service_role using (true);

create or replace function public.seal_crm_accounting_history()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reconciliation public.crm_reconciliations%rowtype;
  v_existing public.crm_accounting_history_lock%rowtype;
  v_sealed_at timestamptz := clock_timestamp();
  v_reconciliation_date date;
  v_current_usd numeric;
  v_current_uah numeric;
  v_locked_usd numeric;
  v_locked_uah numeric;
  v_order_count integer;
  v_item_count integer;
begin
  lock table
    public.crm_reconciliations,
    public.crm_orders,
    public.crm_order_items,
    public.crm_order_item_returns
  in share mode;

  select *
    into v_reconciliation
    from public.crm_reconciliations
   where kind = 'reconciliation'
   order by created_at desc
   limit 1;

  if not found then
    raise exception 'Accounting history seal stopped: latest reconciliation was not found';
  end if;

  select *
    into v_existing
    from public.crm_accounting_history_lock
   where id = 1;

  if found then
    if v_existing.reconciliation_id = v_reconciliation.id then
      return jsonb_build_object(
        'ok', true,
        'alreadySealed', true,
        'reconciliationId', v_existing.reconciliation_id,
        'sealedAt', v_existing.sealed_at,
        'orderCount', (
          select count(*)
          from public.crm_accounting_history_lock_orders
          where lock_id = 1
        ),
        'itemCount', (
          select count(*)
          from public.crm_accounting_history_lock_items
          where lock_id = 1
        ),
        'usd', v_existing.cost_snapshot_usd,
        'uah', v_existing.cost_snapshot_uah
      );
    end if;

    raise exception
      'Accounting history is already sealed at reconciliation %, latest reconciliation is %',
      v_existing.reconciliation_id,
      v_reconciliation.id;
  end if;

  -- Exact production cost-basis rule as of the reviewed main:
  -- includes manual accepted returns and excludes carrier-deleted TTNs.
  select
    coalesce(
      sum(
        case
          when i.cost_usd > 0
            then i.cost_usd * greatest(0, i.quantity - coalesce(r.returned_quantity, 0))
          else 0
        end
      ),
      0
    ),
    coalesce(
      sum(
        case
          when i.cost_usd > 0
            then 0
          else i.cost * greatest(0, i.quantity - coalesce(r.returned_quantity, 0))
        end
      ),
      0
    )
  into v_current_usd, v_current_uah
  from public.crm_orders o
  join public.crm_order_items i on i.order_id = o.id
  left join public.crm_order_item_returns r
    on r.order_id = i.order_id
   and r.item_position = i.position
  where nullif(btrim(coalesce(o.delivery ->> 'ttn', '')), '') is not null
    and lower(btrim(coalesce(o.delivery ->> 'trackingNormalizedStatus', ''))) <> 'deleted'
    and not (
      (
        lower(coalesce(o.status, '')) ~ '(скас|отмен|cancel|повер|возврат|return|refund|відмов.*отрим)'
        or lower(btrim(coalesce(o.delivery ->> 'trackingNormalizedStatus', ''))) in ('returning', 'returned')
      )
      and nullif(btrim(coalesce(o.delivery ->> 'printedAt', '')), '') is null
      and lower(btrim(coalesce(o.delivery ->> 'trackingNormalizedStatus', ''))) not in (
        'accepted',
        'in_transit',
        'ready_for_pickup',
        'delivered',
        'returning',
        'returned'
      )
    );

  if abs(v_current_usd - v_reconciliation.cost_snapshot_usd) > numeric '0.000001'
     or abs(v_current_uah - v_reconciliation.cost_snapshot_uah) > numeric '0.000001' then
    raise exception
      'Accounting history seal stopped: current costs do not match latest reconciliation snapshot (current USD %, snapshot USD %, current UAH %, snapshot UAH %)',
      v_current_usd,
      v_reconciliation.cost_snapshot_usd,
      v_current_uah,
      v_reconciliation.cost_snapshot_uah;
  end if;

  v_reconciliation_date :=
    (v_reconciliation.reconciled_at at time zone 'Europe/Kyiv')::date;

  insert into public.crm_accounting_history_lock (
    id,
    reconciliation_id,
    reconciled_at,
    reconciliation_date,
    sealed_at,
    cost_snapshot_usd,
    cost_snapshot_uah
  )
  values (
    1,
    v_reconciliation.id,
    v_reconciliation.reconciled_at,
    v_reconciliation_date,
    v_sealed_at,
    v_reconciliation.cost_snapshot_usd,
    v_reconciliation.cost_snapshot_uah
  );

  -- Lock every order that has already entered a shipping/return lifecycle,
  -- including zero-contribution deleted/cancelled historical orders.
  -- A clean active order with no TTN, no physical/tracking evidence and no
  -- cancellation/return signal is intentionally left live for future shipment.
  insert into public.crm_accounting_history_lock_orders (
    lock_id,
    order_id,
    included_at_seal
  )
  select
    1,
    o.id,
    (
      nullif(btrim(coalesce(o.delivery ->> 'ttn', '')), '') is not null
      and lower(btrim(coalesce(o.delivery ->> 'trackingNormalizedStatus', ''))) <> 'deleted'
      and not (
        (
          lower(coalesce(o.status, '')) ~ '(скас|отмен|cancel|повер|возврат|return|refund|відмов.*отрим)'
          or lower(btrim(coalesce(o.delivery ->> 'trackingNormalizedStatus', ''))) in ('returning', 'returned')
        )
        and nullif(btrim(coalesce(o.delivery ->> 'printedAt', '')), '') is null
        and lower(btrim(coalesce(o.delivery ->> 'trackingNormalizedStatus', ''))) not in (
          'accepted',
          'in_transit',
          'ready_for_pickup',
          'delivered',
          'returning',
          'returned'
        )
      )
    ) as included_at_seal
  from public.crm_orders o
  where
    nullif(btrim(coalesce(o.delivery ->> 'ttn', '')), '') is not null
    or nullif(btrim(coalesce(o.delivery ->> 'printedAt', '')), '') is not null
    or lower(btrim(coalesce(o.delivery ->> 'trackingNormalizedStatus', ''))) in (
      'accepted',
      'in_transit',
      'ready_for_pickup',
      'delivered',
      'returning',
      'returned',
      'deleted'
    )
    or lower(coalesce(o.delivery ->> 'trackingReturnInProgress', '')) = 'true'
    or lower(coalesce(o.delivery ->> 'trackingReturnArrived', '')) = 'true'
    or (
      jsonb_typeof(o.delivery -> 'shipmentHistory') = 'array'
      and jsonb_array_length(o.delivery -> 'shipmentHistory') > 0
    )
    or lower(coalesce(o.status, '')) ~ '(скас|отмен|cancel|повер|возврат|return|refund|відмов.*отрим)';

  get diagnostics v_order_count = row_count;

  insert into public.crm_accounting_history_lock_items (
    lock_id,
    order_id,
    item_position,
    product_name,
    quantity,
    returned_quantity_at_seal,
    cost,
    cost_usd
  )
  select
    1,
    i.order_id,
    i.position,
    i.product_name,
    i.quantity,
    coalesce(r.returned_quantity, 0),
    coalesce(i.cost, 0),
    coalesce(i.cost_usd, 0)
  from public.crm_accounting_history_lock_orders lo
  join public.crm_order_items i
    on i.order_id = lo.order_id
  left join public.crm_order_item_returns r
    on r.order_id = i.order_id
   and r.item_position = i.position
  where lo.lock_id = 1;

  get diagnostics v_item_count = row_count;

  select
    coalesce(
      sum(
        case
          when lo.included_at_seal and li.cost_usd > 0
            then li.cost_usd * greatest(0, li.quantity - li.returned_quantity_at_seal)
          else 0
        end
      ),
      0
    ),
    coalesce(
      sum(
        case
          when lo.included_at_seal and li.cost_usd <= 0
            then li.cost * greatest(0, li.quantity - li.returned_quantity_at_seal)
          else 0
        end
      ),
      0
    )
  into v_locked_usd, v_locked_uah
  from public.crm_accounting_history_lock_orders lo
  join public.crm_accounting_history_lock_items li
    on li.lock_id = lo.lock_id
   and li.order_id = lo.order_id
  where lo.lock_id = 1;

  if abs(v_locked_usd - v_reconciliation.cost_snapshot_usd) > numeric '0.000001'
     or abs(v_locked_uah - v_reconciliation.cost_snapshot_uah) > numeric '0.000001' then
    raise exception
      'Accounting history seal stopped: frozen snapshot does not match reconciliation (locked USD %, snapshot USD %, locked UAH %, snapshot UAH %)',
      v_locked_usd,
      v_reconciliation.cost_snapshot_usd,
      v_locked_uah,
      v_reconciliation.cost_snapshot_uah;
  end if;

  return jsonb_build_object(
    'ok', true,
    'alreadySealed', false,
    'reconciliationId', v_reconciliation.id,
    'sealedAt', v_sealed_at,
    'reconciliationDate', v_reconciliation_date,
    'orderCount', v_order_count,
    'itemCount', v_item_count,
    'usd', v_reconciliation.cost_snapshot_usd,
    'uah', v_reconciliation.cost_snapshot_uah
  );
end;
$$;

revoke all on function public.seal_crm_accounting_history()
from public, anon, authenticated;
grant execute on function public.seal_crm_accounting_history()
to service_role;

create or replace function public.get_crm_current_cost_totals()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  with active_lock as (
    select *
    from public.crm_accounting_history_lock
    where id = 1
  ),
  locked_quantities as (
    select
      lo.included_at_seal,
      li.cost,
      li.cost_usd,
      greatest(
        0,
        li.quantity
          - li.returned_quantity_at_seal
          - case
              when r.returned_quantity is null then 0
              when r.returned_at > l.reconciliation_date then
                greatest(0, r.returned_quantity - li.returned_quantity_at_seal)
              when r.returned_at = l.reconciliation_date
                   and r.updated_at > l.sealed_at then
                greatest(0, r.returned_quantity - li.returned_quantity_at_seal)
              else 0
            end
      ) as remaining_quantity
    from public.crm_accounting_history_lock_orders lo
    join active_lock l on l.id = lo.lock_id
    join public.crm_accounting_history_lock_items li
      on li.lock_id = lo.lock_id
     and li.order_id = lo.order_id
    left join public.crm_order_item_returns r
      on r.order_id = li.order_id
     and r.item_position = li.item_position
  ),
  locked_contributions as (
    select
      case
        when included_at_seal and cost_usd > 0
          then cost_usd * remaining_quantity
        else 0
      end as usd,
      case
        when included_at_seal and cost_usd <= 0
          then cost * remaining_quantity
        else 0
      end as uah
    from locked_quantities
  ),
  live_contributions as (
    select
      case
        when i.cost_usd > 0
          then i.cost_usd * greatest(0, i.quantity - coalesce(r.returned_quantity, 0))
        else 0
      end as usd,
      case
        when i.cost_usd > 0
          then 0
        else i.cost * greatest(0, i.quantity - coalesce(r.returned_quantity, 0))
      end as uah
    from public.crm_orders o
    join public.crm_order_items i on i.order_id = o.id
    left join public.crm_order_item_returns r
      on r.order_id = i.order_id
     and r.item_position = i.position
    left join active_lock l on true
    left join public.crm_accounting_history_lock_orders lo
      on lo.lock_id = l.id
     and lo.order_id = o.id
    where lo.order_id is null
      and nullif(btrim(coalesce(o.delivery ->> 'ttn', '')), '') is not null
      and lower(btrim(coalesce(o.delivery ->> 'trackingNormalizedStatus', ''))) <> 'deleted'
      and not (
        (
          lower(coalesce(o.status, '')) ~ '(скас|отмен|cancel|повер|возврат|return|refund|відмов.*отрим)'
          or lower(btrim(coalesce(o.delivery ->> 'trackingNormalizedStatus', ''))) in ('returning', 'returned')
        )
        and nullif(btrim(coalesce(o.delivery ->> 'printedAt', '')), '') is null
        and lower(btrim(coalesce(o.delivery ->> 'trackingNormalizedStatus', ''))) not in (
          'accepted',
          'in_transit',
          'ready_for_pickup',
          'delivered',
          'returning',
          'returned'
        )
      )
  ),
  all_contributions as (
    select usd, uah from locked_contributions
    union all
    select usd, uah from live_contributions
  )
  select jsonb_build_object(
    'usd', coalesce(sum(usd), 0),
    'uah', coalesce(sum(uah), 0)
  )
  from all_contributions;
$$;

revoke all on function public.get_crm_current_cost_totals()
from public, anon;
grant execute on function public.get_crm_current_cost_totals()
to authenticated;
