create or replace function public.replace_crm_order_items(p_order_id uuid, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a JSON array';
  end if;

  delete from public.crm_order_items where order_id = p_order_id;

  insert into public.crm_order_items (
    order_id, position, product_name, size, image_url, quantity, price, cost, cost_usd,
    marketplace_product_key, cost_manual, price_item_id,
    royalty_percent, royalty_amount, royalty_manual
  )
  select
    p_order_id, item.position, item.product_name, item.size, item.image_url,
    item.quantity, item.price, item.cost, item.cost_usd,
    item.marketplace_product_key, coalesce(item.cost_manual, false), item.price_item_id,
    item.royalty_percent, item.royalty_amount, coalesce(item.royalty_manual, false)
  from jsonb_populate_recordset(null::public.crm_order_items, p_items) as item;
end;
$$;

revoke all on function public.replace_crm_order_items(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_crm_order_items(uuid, jsonb) to service_role;
