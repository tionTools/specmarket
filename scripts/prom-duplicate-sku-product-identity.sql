begin;

do $$
declare
  changed_rows integer;
begin
  if not exists (
    select 1 from public.crm_price_items
    where id = '97c64530-4434-43e2-b00c-414c1f27329a' and usd = 0.42
  ) or not exists (
    select 1 from public.crm_price_items
    where id = '48f5a45a-0d65-4d41-8b8a-6be7dd72fd1c' and usd = 11.5
  ) then
    raise exception 'Prom product price prerequisites changed';
  end if;

  update public.crm_product_price_links
  set price_item_id = '48f5a45a-0d65-4d41-8b8a-6be7dd72fd1c',
      product_title = 'Куртка робоча зимова утеплена з капюшоном темно-синя YES-WIN-LJ XL',
      size = 'XL', updated_at = now()
  where platform = 'Пром'
    and marketplace_product_key = 'variation_group:968085463'
    and price_item_id = '97c64530-4434-43e2-b00c-414c1f27329a';
  get diagnostics changed_rows = row_count;
  if changed_rows <> 1 then raise exception 'Prom jacket family link changed'; end if;

  insert into public.crm_product_price_links
    (platform, marketplace_product_key, price_item_id, product_title, size)
  values
    ('Пром', 'product:3253005080', '97c64530-4434-43e2-b00c-414c1f27329a',
      'Рукавички робочі зимові з вологостійким латексним покриттям Urgent 1025Y синьо-чорні', '10'),
    ('Пром', 'product:3269437698', '48f5a45a-0d65-4d41-8b8a-6be7dd72fd1c',
      'Куртка робоча зимова утеплена з капюшоном темно-синя YES-WIN-LJ XXL', 'XXL')
  on conflict (platform, marketplace_product_key) do nothing;
  if (
    select count(*) from public.crm_product_price_links
    where platform = 'Пром' and (
      (marketplace_product_key = 'product:3253005080' and price_item_id = '97c64530-4434-43e2-b00c-414c1f27329a') or
      (marketplace_product_key = 'product:3269437698' and price_item_id = '48f5a45a-0d65-4d41-8b8a-6be7dd72fd1c')
    )
  ) <> 2 then raise exception 'Prom product-specific price links conflict'; end if;

  delete from public.crm_marketplace_product_families
  where platform = 'Пром' and marketplace_product_key = 'sku:759'
    and family_key = 'variation_group:968085463';
  get diagnostics changed_rows = row_count;
  if changed_rows <> 1 then raise exception 'Prom duplicate SKU mapping changed'; end if;

  update public.crm_order_items as item
  set price_item_id = '97c64530-4434-43e2-b00c-414c1f27329a',
      cost_usd = 0.42, cost = 20.16
  from public.crm_orders as order_row
  where item.order_id = order_row.id and order_row.order_number = 440852703
    and order_row.platform = 'Пром' and order_row.status = 'Скасовано'
    and item.position = 0 and item.product_name like '%Urgent 1025Y%'
    and item.price_item_id = '48f5a45a-0d65-4d41-8b8a-6be7dd72fd1c'
    and item.cost_usd = 11.5 and item.cost = 552 and item.cost_manual = false;
  get diagnostics changed_rows = row_count;
  if changed_rows <> 1 then raise exception 'Cancelled glove order changed'; end if;
end $$;

commit;

