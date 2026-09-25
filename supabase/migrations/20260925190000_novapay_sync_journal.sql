create table public.crm_novapay_sync_log (
  id uuid primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  source text not null check (source in ('scheduled', 'manual', 'balance')),
  status text not null check (status in ('running', 'failed')),
  stage text not null check (stage in ('starting', 'authorization', 'auth_request', 'data_sync')),
  code text check (code is null or code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  reason text check (reason is null or reason ~ '^[a-zA-Z0-9_]{1,64}$'),
  request_ref text check (request_ref is null or request_ref ~ '^REQ-[A-F0-9]{12}$')
);

create index crm_novapay_sync_log_started_at_idx
  on public.crm_novapay_sync_log (started_at desc);

alter table public.crm_novapay_sync_log enable row level security;
revoke all on table public.crm_novapay_sync_log from public, anon, authenticated, service_role;
grant select on table public.crm_novapay_sync_log to authenticated;
grant select, insert, update, delete on table public.crm_novapay_sync_log to service_role;

create policy crm_novapay_sync_log_read_authenticated
on public.crm_novapay_sync_log
for select to authenticated
using (lower(coalesce(auth.jwt() ->> 'email', '')) <> 'guest@gmail.com');

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'crm_novapay_sync_log'
  ) then
    alter publication supabase_realtime add table public.crm_novapay_sync_log;
  end if;
end;
$$;

notify pgrst, 'reload schema';
