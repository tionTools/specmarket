begin;

do $$
declare
  changed_rows integer;
begin
  if not exists (
    select 1 from public.crm_marketplace_product_families
    where platform = 'Пром' and marketplace_product_key = 'sku:763'
      and family_key = 'variation_group:968085463'
  ) or not exists (
    select 1 from public.crm_product_price_links
    where platform = 'Пром' and marketplace_product_key = 'variation_group:968085463'
      and price_item_id = '48f5a45a-0d65-4d41-8b8a-6be7dd72fd1c'
  ) then
    raise exception 'Current jacket family prerequisites changed';
  end if;

  update public.crm_product_price_links
  set price_item_id = '97c64530-4434-43e2-b00c-414c1f27329a', updated_at = now()
  where platform = 'Пром' and marketplace_product_key = 'sku:759'
    and price_item_id = '48f5a45a-0d65-4d41-8b8a-6be7dd72fd1c'
    and product_title like '%Urgent 1025Y%';
  get diagnostics changed_rows = row_count;
  if changed_rows <> 1 then raise exception 'Glove SKU price link changed'; end if;

  delete from public.crm_marketplace_product_families
  where platform = 'Пром' and marketplace_product_key = 'sku:759'
    and family_key = 'variation_group:968085463';
  get diagnostics changed_rows = row_count;
  if changed_rows <> 1 then raise exception 'Stale jacket SKU mapping changed'; end if;
end $$;

commit;

