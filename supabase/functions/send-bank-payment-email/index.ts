import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendBankPaymentEmail } from '../_shared/bank-notification.ts'

const text = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return Response.json({ ok: false, message: 'Method not allowed.' }, { status: 405 })
  }

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const authorization = request.headers.get('Authorization')
  if (!url || !serviceKey || !authorization) {
    return Response.json({ ok: false, message: 'Bank notification configuration is incomplete.' }, { status: 500 })
  }

  const admin = createClient(url, serviceKey)
  const { data: cronSecret, error: cronSecretError } = await admin.rpc('get_crm_sync_cron_secret')
  if (
    cronSecretError ||
    typeof cronSecret !== 'string' ||
    authorization !== `Bearer ${cronSecret}`
  ) {
    return Response.json({ ok: false, message: 'Unauthorized.' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({})) as { eventId?: string }
  const eventId = text(body.eventId)
  if (!eventId) {
    return Response.json({ ok: false, message: 'eventId is required.' }, { status: 400 })
  }

  const { data: event, error: eventError } = await admin
    .from('bank_payment_events')
    .select('id,bank,occurred_at,amount,balance,payer,description,comment')
    .eq('id', eventId)
    .maybeSingle()

  if (eventError) {
    return Response.json({ ok: false, message: eventError.message }, { status: 500 })
  }
  if (!event) {
    return Response.json({ ok: true, skipped: true, reason: 'event_not_found' })
  }
  if (event.bank !== 'monobank' && event.bank !== 'novapay') {
    return Response.json({ ok: true, skipped: true, reason: 'unsupported_bank' })
  }

  const amount = Number(event.amount)
  const balance = event.balance === null ? null : Number(event.balance)
  if (!Number.isFinite(amount) || amount <= 0) {
    return Response.json({ ok: true, skipped: true, reason: 'non_positive_amount' })
  }

  const sent = await sendBankPaymentEmail(admin, {
    bank: event.bank,
    occurredAt: text(event.occurred_at),
    amount,
    balance: balance !== null && Number.isFinite(balance) ? balance : null,
    payer: text(event.payer),
    purpose: text(event.comment) || text(event.description),
  })

  return Response.json({ ok: true, sent })
})
