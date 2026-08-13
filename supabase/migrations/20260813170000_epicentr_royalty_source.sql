alter table public.crm_order_items
  add column if not exists royalty_manual boolean not null default false;

update public.crm_order_items as item
set royalty_manual = true
from public.crm_orders as orders
where item.order_id = orders.id
  and orders.platform = 'Эпицентр'
  and item.royalty_amount is not null;
