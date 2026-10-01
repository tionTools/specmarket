create or replace function public.touch_parent_crm_order_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent_order_id uuid;
begin
  if current_setting('specmarket.skip_crm_order_item_parent_touch', true) = 'on' then
    return null;
  end if;

  parent_order_id := case when tg_op = 'DELETE' then old.order_id else new.order_id end;

  update public.crm_orders
     set updated_at = now()
   where id = parent_order_id;

  return null;
end;
$$;

create or replace function public.replace_crm_order_items(p_order_id uuid, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  items_changed boolean;
  previous_skip_parent_touch text;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a JSON array';
  end if;

  with incoming_items as (
    select
      item.position,
      item.product_name,
      item.size,
      item.image_url,
      item.quantity,
      item.price,
      item.cost,
      item.cost_usd,
      item.marketplace_product_key,
      coalesce(item.cost_manual, false) as cost_manual,
      item.price_item_id,
      item.royalty_percent,
      item.royalty_amount,
      coalesce(item.royalty_manual, false) as royalty_manual
    from jsonb_populate_recordset(null::public.crm_order_items, p_items) as item
  ),
  current_items as (
    select
      item.position,
      item.product_name,
      item.size,
      item.image_url,
      item.quantity,
      item.price,
      item.cost,
      item.cost_usd,
      item.marketplace_product_key,
      item.cost_manual,
      item.price_item_id,
      item.royalty_percent,
      item.royalty_amount,
      item.royalty_manual
    from public.crm_order_items item
    where item.order_id = p_order_id
  ),
  removed_or_changed as (
    select * from current_items
    except all
    select * from incoming_items
  ),
  added_or_changed as (
    select * from incoming_items
    except all
    select * from current_items
  )
  select exists (
    select 1 from removed_or_changed
    union all
    select 1 from added_or_changed
  )
  into items_changed;

  if not items_changed then
    return;
  end if;

  previous_skip_parent_touch := current_setting('specmarket.skip_crm_order_item_parent_touch', true);
  perform set_config('specmarket.skip_crm_order_item_parent_touch', 'on', true);

  delete from public.crm_order_items
  where order_id = p_order_id;

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

  perform set_config(
    'specmarket.skip_crm_order_item_parent_touch',
    coalesce(previous_skip_parent_touch, 'off'),
    true
  );

  update public.crm_orders
     set updated_at = now()
   where id = p_order_id;
end;
$$;

revoke all on function public.replace_crm_order_items(uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.replace_crm_order_items(uuid, jsonb)
to service_role;
