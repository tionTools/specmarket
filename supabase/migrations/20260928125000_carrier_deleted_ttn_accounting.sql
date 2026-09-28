-- Carrier TTN state and marketplace order state are independent.
-- A carrier-reported deleted TTN is not a marketplace cancellation, but it is
-- not a physical shipment and must not contribute to shipment accounting.

update public.crm_orders
set delivery = jsonb_set(delivery, '{trackingNormalizedStatus}', to_jsonb('deleted'::text), true)
where lower(btrim(coalesce(delivery ->> 'trackingStatus', ''))) ~ '(видален|удален|deleted)'
  and lower(btrim(coalesce(delivery ->> 'trackingNormalizedStatus', ''))) <> 'deleted';

create or replace function public.get_crm_current_cost_totals()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'usd',
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
    'uah',
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
  )
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
$$;

revoke all on function public.get_crm_current_cost_totals() from public, anon;
grant execute on function public.get_crm_current_cost_totals() to authenticated;
