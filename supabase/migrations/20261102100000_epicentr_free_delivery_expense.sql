create or replace function public.apply_crm_marketplace_order_snapshot(
  p_order_id uuid,
  p_data jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_order public.crm_orders%rowtype;
  v_next_order public.crm_orders%rowtype;
  v_current_delivery jsonb;
  v_next_delivery jsonb;
begin
  if p_order_id is null
    or p_data is null
    or jsonb_typeof(p_data) <> 'object'
    or jsonb_typeof(p_data -> 'delivery') <> 'object' then
    raise exception 'Invalid marketplace order update';
  end if;

  select *
    into v_current_order
    from public.crm_orders
   where id = p_order_id
   for update;

  if not found then
    return false;
  end if;

  v_current_delivery := coalesce(v_current_order.delivery, '{}'::jsonb);
  v_next_delivery := (p_data -> 'delivery') - 'paymentAmount' - 'rozetkaPayOperationIds';

  if v_current_delivery ? 'paymentAmount' then
    v_next_delivery := jsonb_set(
      v_next_delivery,
      '{paymentAmount}',
      v_current_delivery -> 'paymentAmount',
      true
    );
  end if;

  if v_current_delivery ? 'rozetkaPayOperationIds' then
    v_next_delivery := jsonb_set(
      v_next_delivery,
      '{rozetkaPayOperationIds}',
      v_current_delivery -> 'rozetkaPayOperationIds',
      true
    );
  end if;

  v_next_order := jsonb_populate_record(
    v_current_order,
    p_data - 'delivery' - 'acquiring' - 'acquiring_percent'
  );

  -- Resolve seller expense under the row lock so a concurrent manual edit wins.
  if v_current_order.platform = 'Эпицентр' then
    if v_current_delivery ->> 'shippingSource' = 'manual' then
      v_next_order.shipping := v_current_order.shipping;
      v_next_delivery := jsonb_set(v_next_delivery, '{shippingSource}', '"manual"'::jsonb);
    elsif v_next_delivery ->> 'shippingSource' = 'seller-api'
      and v_next_delivery -> 'isFree' = 'true'::jsonb
      and jsonb_typeof(v_next_delivery -> 'deliveryPrice') = 'number' then
      if (v_next_delivery ->> 'deliveryPrice')::numeric >= 0 then
        v_next_order.shipping := (v_next_delivery ->> 'deliveryPrice')::numeric;
      end if;
    end if;
  end if;
  update public.crm_orders
     set external_id = v_next_order.external_id,
         order_number = v_next_order.order_number,
         order_label = v_next_order.order_label,
         order_date = v_next_order.order_date,
         order_time = v_next_order.order_time,
         customer = v_next_order.customer,
         phone = v_next_order.phone,
         customer_email = v_next_order.customer_email,
         customer_comment = v_next_order.customer_comment,
         platform = v_next_order.platform,
         status = v_next_order.status,
         shipping = v_next_order.shipping,
         delivery = v_next_delivery
   where id = p_order_id;

  return true;
end;
$$;

