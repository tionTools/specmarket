create table public.crm_registry_import_identifiers (
  bank text not null check (bank in ('monobank', 'novapay')),
  identifier text not null check (btrim(identifier) <> ''),
  identifier_type text not null check (identifier_type in ('registry', 'operation')),
  label text not null check (btrim(label) <> ''),
  source text not null check (btrim(source) <> ''),
  applied_at timestamptz not null default now(),
  primary key (bank, identifier)
);

alter table public.crm_registry_import_identifiers enable row level security;

revoke all on table public.crm_registry_import_identifiers from public, anon, authenticated;
grant select, insert on table public.crm_registry_import_identifiers to authenticated;

create policy crm_registry_import_identifiers_read_authenticated
on public.crm_registry_import_identifiers
for select
to authenticated
using (
  auth.uid() is not null
  and lower(coalesce(auth.jwt() ->> 'email', '')) <> 'guest@gmail.com'
);

create policy crm_registry_import_identifiers_insert_authenticated
on public.crm_registry_import_identifiers
for insert
to authenticated
with check (
  auth.uid() is not null
  and lower(coalesce(auth.jwt() ->> 'email', '')) <> 'guest@gmail.com'
);
