-- Payment-registry confirmation must update only registry-owned financial fields.
-- Marketplace syncs keep writing the rest of the order, but they merge delivery state
-- without overwriting a payment/FC ID committed concurrently by another browser.

create or replace function public.apply_crm_registry_financials(p_updates jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_update jsonb;
  v_order_id uuid;
  v_payment_amount numeric;
  v_acquiring numeric;
  v_acquiring_percent numeric;
  v_operation_ids jsonb;
  v_current_delivery jsonb;
  v_next_delivery jsonb;
  v_merged_operation_ids jsonb;
  v_updated_count integer := 0;
begin
  if auth.uid() is null
    or lower(coalesce(auth.jwt() ->> 'email', '')) = 'guest@gmail.com' then
    raise exception 'Not allowed to apply payment registry';
  end if;

  if p_updates is null
    or jsonb_typeof(p_updates) <> 'array'
    or jsonb_array_length(p_updates) = 0
    or jsonb_array_length(p_updates) > 500 then
    raise exception 'Invalid payment registry batch';
  end if;

  for v_update in
    select value
    from jsonb_array_elements(p_updates)
  loop
    if jsonb_typeof(v_update) <> 'object'
      or not (v_update ? 'orderId')
      or not (v_update ? 'paymentAmount')
      or not (v_update ? 'acquiring')
      or not (v_update ? 'acquiringPercent') then
      raise exception 'Invalid payment registry update';
    end if;

    begin
      v_order_id := nullif(btrim(v_update ->> 'orderId'), '')::uuid;
      v_payment_amount := (v_update ->> 'paymentAmount')::numeric;
      v_acquiring := (v_update ->> 'acquiring')::numeric;
      v_acquiring_percent := nullif(v_update ->> 'acquiringPercent', '')::numeric;
    exception
      when invalid_text_representation then
        raise exception 'Invalid payment registry numeric value';
    end;

    if v_order_id is null
      or v_payment_amount is null
      or v_acquiring is null
      or v_payment_amount < 0
      or v_acquiring < 0
      or (v_acquiring_percent is not null and v_acquiring_percent < 0) then
      raise exception 'Invalid payment registry financial value';
    end if;

    v_operation_ids := coalesce(v_update -> 'operationIds', '[]'::jsonb);
    if jsonb_typeof(v_operation_ids) <> 'array'
      or exists (
        select 1
        from jsonb_array_elements(v_operation_ids) as item(value)
        where jsonb_typeof(item.value) <> 'string'
          or btrim(item.value #>> '{}') = ''
      ) then
      raise exception 'Invalid payment registry operation IDs';
    end if;

    select coalesce(delivery, '{}'::jsonb)
      into v_current_delivery
      from public.crm_orders
     where id = v_order_id
     for update;

    if not found then
      raise exception 'Payment registry order not found: %', v_order_id;
    end if;

    v_next_delivery := jsonb_set(
      v_current_delivery,
      '{paymentAmount}',
      to_jsonb(v_payment_amount),
      true
    );

    if jsonb_array_length(v_operation_ids) > 0 then
      select coalesce(jsonb_agg(value order by first_position), '[]'::jsonb)
        into v_merged_operation_ids
        from (
          select value, min(position) as first_position
          from (
            select value, ordinality::bigint as position
            from jsonb_array_elements_text(
              case
                when jsonb_typeof(v_current_delivery -> 'rozetkaPayOperationIds') = 'array'
                  then v_current_delivery -> 'rozetkaPayOperationIds'
                else '[]'::jsonb
              end
            ) with ordinality as existing(value, ordinality)

            union all

            select value, 1000000 + ordinality::bigint as position
            from jsonb_array_elements_text(v_operation_ids)
              with ordinality as incoming(value, ordinality)
          ) as all_ids
          group by value
        ) as unique_ids;

      v_next_delivery := jsonb_set(
        v_next_delivery,
        '{rozetkaPayOperationIds}',
        v_merged_operation_ids,
        true
      );
    end if;

    update public.crm_orders
       set acquiring = v_acquiring,
           acquiring_percent = v_acquiring_percent,
           delivery = v_next_delivery
     where id = v_order_id;

    v_updated_count := v_updated_count + 1;
  end loop;

  return v_updated_count;
end;
$$;

revoke all on function public.apply_crm_registry_financials(jsonb) from public, anon;
grant execute on function public.apply_crm_registry_financials(jsonb) to authenticated;

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

revoke all on function public.apply_crm_marketplace_order_snapshot(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_crm_marketplace_order_snapshot(uuid, jsonb)
  to service_role;
