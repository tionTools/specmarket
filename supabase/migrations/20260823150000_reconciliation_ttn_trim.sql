create or replace function public.get_crm_current_cost_totals()
returns jsonb language sql security definer set search_path = '' as $$
 select jsonb_build_object('usd', coalesce(sum(case when i.cost_usd > 0 then i.cost_usd * greatest(0, i.quantity - coalesce(r.returned_quantity, 0)) else 0 end), 0),
                           'uah', coalesce(sum(case when i.cost_usd > 0 then 0 else i.cost * greatest(0, i.quantity - coalesce(r.returned_quantity, 0)) end), 0))
 from public.crm_orders o join public.crm_order_items i on i.order_id = o.id
 left join public.crm_order_item_returns r on r.order_id = i.order_id and r.item_position = i.position
 where nullif(btrim(coalesce(o.delivery->>'ttn', '')), '') is not null;
$$;
revoke all on function public.get_crm_current_cost_totals() from public, anon;
grant execute on function public.get_crm_current_cost_totals() to authenticated;
