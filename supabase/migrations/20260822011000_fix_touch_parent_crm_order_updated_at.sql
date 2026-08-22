create or replace function public.touch_parent_crm_order_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent_order_id uuid;
begin
  parent_order_id := case when tg_op = 'DELETE' then old.order_id else new.order_id end;

  update public.crm_orders
     set updated_at = now()
   where id = parent_order_id;

  return null;
end;
$$;
