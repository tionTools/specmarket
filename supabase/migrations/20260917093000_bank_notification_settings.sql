create table public.bank_notification_settings (
  id smallint primary key default 1 check (id = 1),
  recipient_email text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.bank_notification_settings enable row level security;

revoke all on table public.bank_notification_settings from public, anon, authenticated;
grant select, insert, update on table public.bank_notification_settings to authenticated;
grant all on table public.bank_notification_settings to service_role;

create policy bank_notification_settings_authenticated
on public.bank_notification_settings
for all
to authenticated
using (lower(coalesce(auth.jwt() ->> 'email', '')) <> 'guest@gmail.com')
with check (lower(coalesce(auth.jwt() ->> 'email', '')) <> 'guest@gmail.com');

insert into public.bank_notification_settings (id, recipient_email)
values (1, '')
on conflict (id) do nothing;
