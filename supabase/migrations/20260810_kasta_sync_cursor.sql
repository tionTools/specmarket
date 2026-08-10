create table if not exists public.crm_sync_cursors (
  source text primary key,
  cursor text not null,
  updated_at timestamptz not null default now()
);

alter table public.crm_orders
  add column if not exists order_label text;

alter table public.crm_sync_cursors enable row level security;

drop policy if exists "crm_sync_cursors_no_direct_access" on public.crm_sync_cursors;
create policy "crm_sync_cursors_no_direct_access"
  on public.crm_sync_cursors for all
  using (false)
  with check (false);
