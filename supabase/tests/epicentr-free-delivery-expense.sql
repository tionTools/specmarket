-- Run only in an isolated test database; all fixtures are rolled back.
begin;
create table public.crm_orders (
  id uuid primary key, external_id text, order_number bigint, order_label text,
  order_date text, order_time text, customer text, phone text, customer_email text,
  customer_comment text, platform text, status text, shipping numeric,
  acquiring numeric, acquiring_percent numeric, delivery jsonb
);
\ir ../migrations/20261102100000_epicentr_free_delivery_expense.sql
do $$
declare
  order_id uuid := '00000000-0000-0000-0000-000000000001';
  result public.crm_orders%rowtype;
  snapshot jsonb := '{"delivery":{"shippingSource":"seller-api","deliveryPrice":38.45,"isFree":true}}';
begin
  insert into public.crm_orders(id, platform, shipping, acquiring, delivery)
  values (order_id, 'Эпицентр', 0, 7, '{"shippingSource":"unconfirmed","paymentAmount":690,"rozetkaPayOperationIds":["saved"]}');
  perform public.apply_crm_marketplace_order_snapshot(order_id, snapshot);
  select * into result from public.crm_orders where id=order_id;
  assert result.shipping = 38.45, 'existing zero expense not filled';
  assert result.acquiring = 7 and result.delivery->>'paymentAmount' = '690'
    and result.delivery->'rozetkaPayOperationIds' = '["saved"]', 'bank financials overwritten';
  perform public.apply_crm_marketplace_order_snapshot(order_id, snapshot);
  assert (select shipping=38.45 from public.crm_orders where id=order_id), 'sync must not add the price twice';

  -- A manual edit saved after the marketplace snapshot was prepared must win.
  update public.crm_orders set shipping=12, delivery=delivery || '{"shippingSource":"manual"}' where id=order_id;
  perform public.apply_crm_marketplace_order_snapshot(order_id, snapshot);
  select * into result from public.crm_orders where id=order_id;
  assert result.shipping=12 and result.delivery->>'shippingSource'='manual', 'manual edit overwritten';

  update public.crm_orders set shipping=0, delivery='{}' where id=order_id;
  perform public.apply_crm_marketplace_order_snapshot(order_id, '{"delivery":{"deliveryPrice":38.45,"isFree":false,"shippingSource":"unconfirmed"}}');
  assert (select shipping=0 from public.crm_orders where id=order_id), 'buyer-paid delivery charged';
  perform public.apply_crm_marketplace_order_snapshot(order_id, '{"delivery":{"deliveryPrice":-1,"isFree":true,"shippingSource":"seller-api"}}');
  assert (select shipping=0 from public.crm_orders where id=order_id), 'negative delivery charged';

  update public.crm_orders set platform='Пром', shipping=10 where id=order_id;
  perform public.apply_crm_marketplace_order_snapshot(order_id, snapshot);
  assert (select shipping=10 from public.crm_orders where id=order_id), 'other marketplace changed';
end;
$$;
rollback;
