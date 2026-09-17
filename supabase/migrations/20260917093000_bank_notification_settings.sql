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

create or replace function public.enqueue_bank_payment_email()
returns trigger
language plpgsql
security definer
set search_path = net, vault, public
as $$
declare
  cron_secret text;
begin
  select decrypted_secret into cron_secret
  from vault.decrypted_secrets
  where name = 'crm_sync_cron_secret'
  limit 1;

  if cron_secret is null or cron_secret = '' then
    return new;
  end if;

  perform net.http_post(
    url := 'https://rtkhgldaswsclkorlyxx.supabase.co/functions/v1/send-bank-payment-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || cron_secret
    ),
    body := jsonb_build_object('eventId', new.id),
    timeout_milliseconds := 10000
  );

  return new;
end;
$$;

revoke all on function public.enqueue_bank_payment_email() from public, anon, authenticated;

drop trigger if exists bank_payment_events_email on public.bank_payment_events;
create trigger bank_payment_events_email
after insert on public.bank_payment_events
for each row execute function public.enqueue_bank_payment_email();
