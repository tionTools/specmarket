import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const MONOBANK_CLIENT_INFO_URL = 'https://api.monobank.ua/personal/client-info'
const MONOBANK_STATEMENT_URL = 'https://api.monobank.ua/personal/statement'
const REQUEST_TIMEOUT_MS = 20_000
const REFRESH_COOLDOWN_SECONDS = 90
const PERIOD_SECONDS = 7 * 24 * 60 * 60

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const text = (value) => typeof value === 'string' ? value.trim() : ''
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const finiteNumber = (value) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function formatKyivDate(value) {
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

class HttpError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
    this.details = details
  }
}

function errorResponse(error) {
  if (error instanceof HttpError) {
    return Response.json({
      ok: false,
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    }, { status: error.status, headers: corsHeaders })
  }

  console.error('Monobank data request failed with an unexpected error.')
  return Response.json({ ok: false, code: 'MONOBANK_INTERNAL_ERROR', message: 'Monobank request failed.' }, {
    status: 500,
    headers: corsHeaders,
  })
}

async function monobankFetch(url, apiToken) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  let response

  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { 'X-Token': apiToken },
      signal: controller.signal,
    })
  } catch {
    throw new HttpError(502, 'MONOBANK_TRANSPORT_ERROR', 'Monobank is temporarily unreachable.')
  } finally {
    clearTimeout(timeout)
  }

  const raw = await response.text()
  let payload = null
  try {
    payload = raw ? JSON.parse(raw) : null
  } catch {
    payload = null
  }

  if (!response.ok) {
    const description = isRecord(payload) ? text(payload.errorDescription) : ''
    throw new HttpError(response.status, 'MONOBANK_API_ERROR', 'Monobank rejected the request.', {
      status: response.status,
      ...(description ? { description } : {}),
    })
  }

  return payload
}

function normalizeCache(row) {
  if (!row) {
    return {
      bank: 'monobank',
      balance: null,
      updatedAt: null,
      account: {},
      receipts: [],
      period: { from: null, to: null },
    }
  }

  return {
    bank: 'monobank',
    balance: finiteNumber(row.balance),
    updatedAt: row.updated_at ?? null,
    account: isRecord(row.account) ? row.account : {},
    receipts: Array.isArray(row.receipts) ? row.receipts : [],
    period: {
      from: row.period_from ?? null,
      to: row.period_to ?? null,
    },
  }
}

async function readCache(admin) {
  const { data, error } = await admin
    .from('bank_account_cache')
    .select('bank,balance,updated_at,account,receipts,period_from,period_to')
    .eq('bank', 'monobank')
    .maybeSingle()

  if (error) throw new HttpError(500, 'BANK_CACHE_READ_FAILED', 'Failed to read cached bank data.')
  return normalizeCache(data)
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') {
    return Response.json({ ok: false, message: 'Method not allowed.' }, { status: 405, headers: corsHeaders })
  }

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const apiToken = text(Deno.env.get('MONOBANK_API_TOKEN'))
  const authorization = request.headers.get('Authorization')

  if (!url || !anonKey || !serviceKey || !apiToken) {
    return Response.json({ ok: false, message: 'Monobank configuration is incomplete.' }, {
      status: 500,
      headers: corsHeaders,
    })
  }
  if (!authorization) {
    return Response.json({ ok: false, message: 'Unauthorized.' }, { status: 401, headers: corsHeaders })
  }

  const authClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } })
  const { data: { user }, error: authError } = await authClient.auth.getUser()
  if (authError || !user || user.email?.toLowerCase() === 'guest@gmail.com') {
    return Response.json({ ok: false, message: 'Unauthorized.' }, { status: 401, headers: corsHeaders })
  }

  let body = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  const refresh = isRecord(body) && body.refresh === true
  const admin = createClient(url, serviceKey)

  try {
    const cached = await readCache(admin)
    if (!refresh) {
      return Response.json({ ok: true, refreshed: false, ...cached }, { headers: corsHeaders })
    }

    if (cached.updatedAt) {
      const ageSeconds = Math.floor((Date.now() - new Date(cached.updatedAt).getTime()) / 1000)
      if (Number.isFinite(ageSeconds) && ageSeconds >= 0 && ageSeconds < REFRESH_COOLDOWN_SECONDS) {
        throw new HttpError(429, 'MONOBANK_REFRESH_COOLDOWN', 'Monobank was refreshed recently.', {
          retryAfter: REFRESH_COOLDOWN_SECONDS - ageSeconds,
        })
      }
    }

    const clientData = await monobankFetch(MONOBANK_CLIENT_INFO_URL, apiToken)
    if (!isRecord(clientData) || !Array.isArray(clientData.accounts)) {
      throw new HttpError(502, 'MONOBANK_INVALID_RESPONSE', 'Monobank returned invalid client info.')
    }

    const fopAccounts = clientData.accounts.filter((account) => {
      if (!isRecord(account)) return false
      return text(account.type).toLowerCase() === 'fop' && finiteNumber(account.currencyCode) === 980
    })

    if (fopAccounts.length === 0) {
      throw new HttpError(502, 'MONOBANK_FOP_ACCOUNT_NOT_FOUND', 'Monobank returned no UAH FOP account.')
    }
    if (fopAccounts.length > 1) {
      throw new HttpError(409, 'MONOBANK_FOP_ACCOUNT_SELECTION_REQUIRED', 'Monobank returned more than one UAH FOP account.', {
        accounts: fopAccounts.map((account) => ({
          idSuffix: text(account.id).slice(-6),
          ibanSuffix: text(account.iban).slice(-6),
        })),
      })
    }

    const account = fopAccounts[0]
    const accountId = text(account.id)
    const balanceMinor = finiteNumber(account.balance)
    if (!accountId || balanceMinor === null) {
      throw new HttpError(502, 'MONOBANK_INVALID_RESPONSE', 'Monobank returned incomplete FOP account data.')
    }

    const toSeconds = Math.floor(Date.now() / 1000)
    const fromSeconds = toSeconds - PERIOD_SECONDS
    const statement = await monobankFetch(
      `${MONOBANK_STATEMENT_URL}/${encodeURIComponent(accountId)}/${fromSeconds}/${toSeconds}`,
      apiToken,
    )

    if (!Array.isArray(statement)) {
      throw new HttpError(502, 'MONOBANK_INVALID_RESPONSE', 'Monobank returned invalid statement data.')
    }

    const receipts = statement
      .filter(isRecord)
      .filter((transaction) => (finiteNumber(transaction.amount) ?? 0) > 0)
      .map((transaction) => ({
        id: text(transaction.id),
        date: formatKyivDate((finiteNumber(transaction.time) ?? 0) * 1000),
        description: text(transaction.description),
        amount: (finiteNumber(transaction.amount) ?? 0) / 100,
        balance: finiteNumber(transaction.balance) === null ? null : finiteNumber(transaction.balance) / 100,
        comment: text(transaction.comment),
        sortTime: finiteNumber(transaction.time) ?? 0,
      }))
      .sort((a, b) => b.sortTime - a.sortTime)
      .map(({ sortTime: _sortTime, ...transaction }) => transaction)

    const updatedAt = new Date().toISOString()
    const periodFrom = new Date(fromSeconds * 1000).toISOString()
    const periodTo = new Date(toSeconds * 1000).toISOString()
    const balance = balanceMinor / 100
    const cachedAccount = {
      type: 'fop',
      currencyCode: 980,
      idSuffix: accountId.slice(-6),
      ibanSuffix: text(account.iban).slice(-6),
    }

    const { error: cacheError } = await admin
      .from('bank_account_cache')
      .update({
        balance,
        updated_at: updatedAt,
        account: cachedAccount,
        receipts,
        period_from: periodFrom,
        period_to: periodTo,
      })
      .eq('bank', 'monobank')

    if (cacheError) throw new HttpError(500, 'BANK_CACHE_WRITE_FAILED', 'Failed to save Monobank data.')

    return Response.json({
      ok: true,
      refreshed: true,
      bank: 'monobank',
      balance,
      updatedAt,
      account: cachedAccount,
      receipts,
      period: { from: periodFrom, to: periodTo },
    }, { headers: corsHeaders })
  } catch (error) {
    return errorResponse(error)
  }
})
