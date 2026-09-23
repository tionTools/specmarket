alter table public.crm_orders
  add column excel_copied boolean not null default true;

alter table public.crm_orders
  alter column excel_copied set default false;

create or replace function public.set_crm_orders_excel_copied(
  p_order_ids uuid[],
  p_copied boolean
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_count integer;
begin
  if auth.uid() is null
    or lower(coalesce(auth.jwt() ->> 'email', '')) = 'guest@gmail.com' then
    raise exception 'Not allowed to update Excel marks';
  end if;

  if p_order_ids is null or p_copied is null
    or cardinality(p_order_ids) = 0 or cardinality(p_order_ids) > 100
    or array_position(p_order_ids, null) is not null then
    raise exception 'Invalid Excel mark request';
  end if;

  update public.crm_orders
     set excel_copied = p_copied
   where id = any(p_order_ids);
  get diagnostics updated_count = row_count;

  if updated_count <> cardinality(array(select distinct unnest(p_order_ids))) then
    raise exception 'Some orders were not found';
  end if;

  return updated_count;
end;
$$;

revoke all on function public.set_crm_orders_excel_copied(uuid[], boolean) from public, anon;
grant execute on function public.set_crm_orders_excel_copied(uuid[], boolean) to authenticated;
