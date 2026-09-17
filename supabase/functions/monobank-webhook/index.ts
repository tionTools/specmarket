import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const number = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function formatKyivDate(value: string | number | Date) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('uk-UA', {
    timeZone: 'Europe/Kyiv',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

function matchesSecret(secret: string, key: string) {
  const left = new TextEncoder().encode(secret)
  const right = new TextEncoder().encode(key)
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index]
  return difference === 0
}

function ignored() {
  return Response.json({ ok: true, ignored: true })
}

Deno.serve(async (request) => {
  const secret = text(Deno.env.get('MONOBANK_WEBHOOK_SECRET'))
  const key = new URL(request.url).searchParams.get('key') ?? ''
  if (!secret) return new Response(null, { status: 401 })
  if (!matchesSecret(secret, key)) return new Response(null, { status: 403 })
  if (request.method === 'GET') return new Response(null, { status: 200 })
  if (request.method !== 'POST') return new Response(null, { status: 405 })

  let payload: any
  try {
    payload = await request.json()
  } catch {
    return Response.json({ ok: false, message: 'Malformed payload.' }, { status: 400 })
  }
  if (payload?.type !== 'StatementItem') return ignored()
  const statement = payload?.data?.statementItem
  const account = text(payload?.data?.account)
  const externalId = text(statement?.id)
  const occurredSeconds = number(statement?.time)
  const amountMinor = number(statement?.amount)
  const balanceMinor = number(statement?.balance)
  if (!account || !externalId || !occurredSeconds || amountMinor === null || balanceMinor === null)
    return Response.json({ ok: false, message: 'Malformed payload.' }, { status: 400 })

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return new Response(null, { status: 500 })
  const admin = createClient(url, serviceKey)
  const { data: cache, error: cacheError } = await admin
    .from('bank_account_cache')
    .select('account,updated_at,receipts')
    .eq('bank', 'monobank')
    .maybeSingle()
  if (cacheError) return new Response(null, { status: 500 })
  const idSuffix = text(cache?.account?.idSuffix)
  if (!idSuffix || !account.endsWith(idSuffix)) return ignored()

  const occurredAt = new Date(occurredSeconds * 1000).toISOString()
  const { data: inserted, error: eventError } = await admin
    .from('bank_payment_events')
    .upsert({
      bank: 'monobank', external_id: externalId, occurred_at: occurredAt,
      amount: amountMinor / 100, balance: balanceMinor / 100,
      payer: text(statement?.counterName), description: text(statement?.description), comment: text(statement?.comment),
  }, { onConflict: 'bank,external_id', ignoreDuplicates: true })
    .select('id')
  if (eventError) return new Response(null, { status: 500 })
  const insertedNew = Boolean(inserted?.length)

  const cacheUpdate: Record<string, unknown> = {
    balance: balanceMinor / 100,
    updated_at: occurredAt,
  }
  if (amountMinor > 0) {
    const existingReceipts = Array.isArray(cache?.receipts) ? cache.receipts : []
    const receipt = {
      id: externalId,
      date: formatKyivDate(occurredAt),
      description: text(statement?.description),
      amount: amountMinor / 100,
      balance: balanceMinor / 100,
      comment: text(statement?.comment),
      occurredAt,
    }
    cacheUpdate.receipts = [
      receipt,
      ...existingReceipts.filter((item: any) => text(item?.id) !== externalId),
    ]
  }

  const { error: cacheUpdateError } = await admin.from('bank_account_cache').update(cacheUpdate)
    .eq('bank', 'monobank')
    .or(`updated_at.is.null,updated_at.lte.${occurredAt}`)
  if (cacheUpdateError) return new Response(null, { status: 500 })
  const { error: cleanupError } = await admin.rpc('cleanup_bank_payment_events')
  if (cleanupError) return new Response(null, { status: 500 })
  return insertedNew ? Response.json({ ok: true }) : ignored()
})
