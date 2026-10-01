create or replace function public.broadcast_bank_account_cache_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'bank', new.bank,
      'balance', new.balance,
      'updated_at', new.updated_at
    ),
    'bank_cache_changed',
    'crm:banking',
    true
  );
  return null;
end;
$$;

revoke all on function public.broadcast_bank_account_cache_change()
from public, anon, authenticated;

drop trigger if exists bank_account_cache_broadcast_change on public.bank_account_cache;
create trigger bank_account_cache_broadcast_change
after insert or update on public.bank_account_cache
for each row execute function public.broadcast_bank_account_cache_change();

create or replace function public.broadcast_bank_payment_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'bank', new.bank,
      'amount', new.amount,
      'payer', new.payer,
      'description', new.description,
      'comment', new.comment
    ),
    'bank_payment_inserted',
    'crm:banking',
    true
  );
  return null;
end;
$$;

revoke all on function public.broadcast_bank_payment_event()
from public, anon, authenticated;

drop trigger if exists bank_payment_events_broadcast_insert on public.bank_payment_events;
create trigger bank_payment_events_broadcast_insert
after insert on public.bank_payment_events
for each row execute function public.broadcast_bank_payment_event();

create or replace function public.broadcast_novapay_sync_log_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object('operation', tg_op),
    'novapay_journal_changed',
    'crm:banking',
    true
  );
  return null;
end;
$$;

revoke all on function public.broadcast_novapay_sync_log_change()
from public, anon, authenticated;

drop trigger if exists crm_novapay_sync_log_broadcast_change on public.crm_novapay_sync_log;
create trigger crm_novapay_sync_log_broadcast_change
after insert or update or delete on public.crm_novapay_sync_log
for each row execute function public.broadcast_novapay_sync_log_change();

drop policy if exists "authenticated crm banking broadcast" on realtime.messages;
create policy "authenticated crm banking broadcast"
on realtime.messages
for select
to authenticated
using (
  realtime.topic() = 'crm:banking'
  and extension = 'broadcast'
  and lower(coalesce(auth.jwt() ->> 'email', '')) <> 'guest@gmail.com'
);
