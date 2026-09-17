import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { XMLParser } from 'npm:fast-xml-parser@5.11.1'
import { getValidNovaPayJwt, NovaPayAuthError } from '../_shared/novapay-auth.ts'

const NOVAPAY_URL = 'https://business.novapay.ua/Services/ClientAPIService.svc'
const SOAP_ACTION_BASE = 'http://tempuri.org/IClientAPIService/'
const SOAP_NAMESPACE = 'http://schemas.xmlsoap.org/soap/envelope/'
const TEM_NAMESPACE = 'http://tempuri.org/'
const SOAP_TIMEOUT_MS = 20_000

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
})

class HttpError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
    this.details = details
  }
}

class NovaPayTransportError extends Error {
  constructor(message) {
    super(message)
    this.name = 'NovaPayTransportError'
  }
}

const text = (value) => typeof value === 'string' ? value.trim() : ''
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

function requestRef() {
  return `REQ-${crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function soapEnvelope(method, params) {
  const fields = Object.entries(params)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => `<tem:${key}>${escapeXml(value)}</tem:${key}>`)
    .join('')

  return `<soapenv:Envelope xmlns:soapenv="${SOAP_NAMESPACE}" xmlns:tem="${TEM_NAMESPACE}"><soapenv:Header/><soapenv:Body><tem:${method}><tem:request>${fields}</tem:request></tem:${method}></soapenv:Body></soapenv:Envelope>`
}

function findKey(value, key) {
  if (!isRecord(value)) return undefined
  if (Object.prototype.hasOwnProperty.call(value, key)) return value[key]
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        const found = findKey(item, key)
        if (found !== undefined) return found
      }
    } else {
      const found = findKey(child, key)
      if (found !== undefined) return found
    }
  }
  return undefined
}

function apiError(result, method) {
  const error = isRecord(result?.error) ? result.error : null
  if (!error && text(result?.result).toLowerCase() !== 'error') return null
  return new HttpError(502, 'NOVAPAY_API_ERROR', `NovaPay ${method} failed.`, {
    status: error ? text(error.status) : undefined,
    title: error ? text(error.title) : undefined,
  })
}

async function soapCallOnce(method, params) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SOAP_TIMEOUT_MS)
  let response
  try {
    response = await fetch(NOVAPAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: `${SOAP_ACTION_BASE}${method}`,
      },
      body: soapEnvelope(method, params),
      signal: controller.signal,
    })
  } catch (error) {
    throw new NovaPayTransportError(error instanceof Error ? error.name : 'fetch_failed')
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    throw new NovaPayTransportError(`http_${response.status}`)
  }

  let document
  try {
    document = parser.parse(await response.text())
  } catch {
    throw new HttpError(502, 'NOVAPAY_SOAP_PARSE_ERROR', `NovaPay ${method} returned invalid XML.`)
  }

  const fault = findKey(document, 'Fault')
  if (fault !== undefined) {
    throw new HttpError(502, 'NOVAPAY_SOAP_FAULT', `NovaPay ${method} returned a SOAP fault.`)
  }

  const result = findKey(document, `${method}Result`)
  if (!isRecord(result)) {
    throw new HttpError(502, 'NOVAPAY_SOAP_RESULT_MISSING', `NovaPay ${method} response is missing its result.`)
  }

  const logicalError = apiError(result, method)
  if (logicalError) throw logicalError
  return result
}

async function soapCall(method, params, retryTransport = false) {
  try {
    return await soapCallOnce(method, params)
  } catch (error) {
    if (!retryTransport || !(error instanceof NovaPayTransportError)) throw error
    return await soapCallOnce(method, params)
  }
}

function normalizeCollection(wrapper, itemKey) {
  if (!isRecord(wrapper)) return []
  const items = wrapper[itemKey]
  if (Array.isArray(items)) return items.filter(isRecord)
  return isRecord(items) ? [items] : []
}

function finiteNumber(value, field) {
  const number = Number(text(value).replace(',', '.'))
  if (!Number.isFinite(number)) {
    throw new HttpError(502, 'NOVAPAY_INVALID_RESPONSE', `NovaPay returned invalid ${field}.`)
  }
  return number
}

function optionalNumber(value) {
  const normalized = text(value).replace(',', '.')
  if (!normalized) return null
  const number = Number(normalized)
  return Number.isFinite(number) ? number : null
}

function normalizeXmlRecord(record) {
  if (!isRecord(record)) return {}
  const normalized = {}
  for (const [key, value] of Object.entries(record)) {
    const normalizedKey = key.startsWith('@_') ? key.slice(2) : key
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      normalized[normalizedKey] = String(value).trim()
      continue
    }
    if (isRecord(value) && typeof value['#text'] === 'string') {
      normalized[normalizedKey] = text(value['#text'])
    }
  }
  return normalized
}

function parseNestedXmlCollection(rawXml, rootName, itemName) {
  const xml = text(rawXml)
  if (!xml) return []

  let document
  try {
    document = parser.parse(xml)
  } catch {
    throw new HttpError(502, 'NOVAPAY_NESTED_XML_PARSE_ERROR', `NovaPay ${rootName} XML is invalid.`)
  }

  const root = findKey(document, rootName)
  if (!isRecord(root)) return []
  return normalizeCollection(root, itemName).map(normalizeXmlRecord)
}

function pick(record, ...keys) {
  for (const key of keys) {
    const value = text(record?.[key])
    if (value) return value
  }
  return ''
}

function normalizeIban(value) {
  return text(value).replaceAll(' ', '').toUpperCase()
}

function isIncomingExtractDocument(document, accountIban) {
  const creditIban = normalizeIban(pick(document, 'CreditCodeIBAN', 'CreditIBAN', 'creditIBAN'))
  const debitIban = normalizeIban(pick(document, 'DebitCodeIBAN', 'DebitIBAN', 'debitIBAN'))
  if (creditIban) return creditIban === accountIban
  if (debitIban) return debitIban !== accountIban

  const creditAmount = optionalNumber(pick(document, 'CrncyCredit', 'CreditAmount', 'Credit', 'SumCredit'))
  const debitAmount = optionalNumber(pick(document, 'CrncyDebit', 'DebitAmount', 'Debit', 'SumDebit'))
  if ((creditAmount ?? 0) > 0) return true
  if ((debitAmount ?? 0) > 0) return false

  const direction = pick(document, 'DbtCdtInd', 'Direction', 'OperationType').toUpperCase()
  return ['CRDT', 'CREDIT', 'C', 'K', 'КРЕДИТ'].includes(direction)
}

function extractReceipt(document) {
  const amount = optionalNumber(pick(document, 'Amount', 'CrncyCredit', 'CreditAmount', 'Credit', 'SumCredit'))
  if (amount === null || amount <= 0) return null

  const dayDate = pick(document, 'DayDate', 'OrgDate', 'PaymentDate', 'Date', 'date')
  const dayTime = pick(document, 'Time', 'OrgTime', 'PaymentTime')
  const date = [dayDate, dayTime].filter(Boolean).join(', ')
  const balance = optionalNumber(pick(document, 'Balance', 'Rest', 'CrncyRest', 'EndRest', 'OutRest'))

  return {
    id: pick(document, 'id', 'ID', 'DocumentId', 'DocId', 'Reference', 'Ref'),
    date,
    occurredAt: receiptOccurredAt(dayDate, dayTime),
    description: pick(document, 'DebitName', 'PayerName', 'SenderName', 'Description'),
    amount,
    balance,
    comment: pick(document, 'Purpose', 'Comment', 'Description'),
  }
}

function receiptOccurredAt(dayDate, dayTime) {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(dayDate)
  if (!match) return ''
  const [hours = '0', minutes = '0', seconds = '0'] = dayTime.split(':')
  const value = new Date(Date.UTC(
    Number(match[3]), Number(match[2]) - 1, Number(match[1]), Number(hours), Number(minutes), Number(seconds),
  ))
  return Number.isFinite(value.getTime()) ? value.toISOString() : ''
}

async function receiptExternalId(receipt) {
  if (text(receipt.id)) return text(receipt.id)
  const source = `novapay\u0000${receipt.date}\u0000${receipt.amount}\u0000${receipt.description}\u0000${receipt.comment}`
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source))
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

async function saveNewReceipts(admin, previousReceipts, receipts, hasBaseline) {
  if (!hasBaseline) return
  const known = new Set(await Promise.all(previousReceipts.map(receiptExternalId)))
  for (const receipt of receipts) {
    const externalId = await receiptExternalId(receipt)
    if (known.has(externalId) || !receipt.occurredAt) continue
    const { error } = await admin.from('bank_payment_events').upsert({
      bank: 'novapay', external_id: externalId, occurred_at: receipt.occurredAt,
      amount: receipt.amount, balance: receipt.balance,
      payer: text(receipt.description) || text(receipt.comment),
      description: text(receipt.description), comment: text(receipt.comment),
    }, { onConflict: 'bank,external_id', ignoreDuplicates: true })
    if (error) throw new HttpError(500, 'BANK_PAYMENT_EVENT_WRITE_FAILED', 'Failed to save NovaPay payment event.')
  }
}

function formatNovaDate(date) {
  const parts = new Intl.DateTimeFormat('uk-UA', {
    timeZone: 'Europe/Kyiv',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(date)
  const get = (type) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('day')}.${get('month')}.${get('year')}`
}

function normalizeCache(row) {
  if (!row) {
    return {
      bank: 'novapay',
      balance: null,
      updatedAt: null,
      account: {},
      receipts: [],
      period: { from: null, to: null },
    }
  }

  return {
    bank: 'novapay',
    balance: optionalNumber(row.balance),
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
    .eq('bank', 'novapay')
    .maybeSingle()

  if (error) throw new HttpError(500, 'BANK_CACHE_READ_FAILED', 'Failed to read cached bank data.')
  return normalizeCache(data)
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
  console.error('NovaPay data request failed with an unexpected error.')
  return Response.json({ ok: false, code: 'NOVAPAY_INTERNAL_ERROR', message: 'NovaPay request failed.' }, {
    status: 500,
    headers: corsHeaders,
  })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') {
    return Response.json({ ok: false, message: 'Method not allowed.' }, { status: 405, headers: corsHeaders })
  }

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const authorization = request.headers.get('Authorization')

  if (!url || !anonKey || !serviceKey) {
    return Response.json({ ok: false, message: 'NovaPay configuration is incomplete.' }, { status: 500, headers: corsHeaders })
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
  const compact = isRecord(body) && body.compact === true
  const admin = createClient(url, serviceKey)

  let previousCache
  try {
    previousCache = await readCache(admin)
  } catch (error) {
    return errorResponse(error)
  }
  if (!refresh) return Response.json({ ok: true, refreshed: false, ...previousCache }, { headers: corsHeaders })

  const login = text(Deno.env.get('NOVAPAY_LOGIN'))
  if (!login) {
    return Response.json({ ok: false, message: 'NovaPay configuration is incomplete.' }, { status: 500, headers: corsHeaders })
  }

  try {
    const jwt = await getValidNovaPayJwt({
      admin,
      authenticate: ({ refreshToken, publicCertificate }) => soapCall('UserAuthenticationJWT', {
        request_ref: requestRef(),
        refresh_token: refreshToken,
        login,
        public_certificate: publicCertificate,
      }),
    })

    const clientsResult = await soapCall('GetClientsList', {
      request_ref: requestRef(),
      jwt,
    }, true)
    const clients = normalizeCollection(clientsResult.clients, 'Clients')
    if (clients.length === 0) {
      throw new HttpError(502, 'NOVAPAY_CLIENT_NOT_FOUND', 'NovaPay returned no available enterprise.')
    }
    if (clients.length > 1) {
      throw new HttpError(409, 'NOVAPAY_CLIENT_SELECTION_REQUIRED', 'NovaPay returned more than one enterprise.', {
        clients: clients.map((client) => ({
          id: finiteNumber(client.id, 'client id'),
          name: text(client.name),
          statecode: text(client.statecode),
        })),
      })
    }

    const clientId = finiteNumber(clients[0].id, 'client id')
    const accountsResult = await soapCall('GetAccountsList', {
      request_ref: requestRef(),
      jwt,
      client_id: clientId,
    }, true)
    const accounts = normalizeCollection(accountsResult.accounts, 'Accounts')
    const activeUahAccounts = accounts.filter((account) => {
      const currency = text(account.currency).toUpperCase()
      const statusCode = text(account.statuscode).toLowerCase()
      const status = text(account.status)
      return currency === 'UAH' && (statusCode === 'active' || status === '1')
    })

    if (activeUahAccounts.length === 0) {
      throw new HttpError(502, 'NOVAPAY_ACCOUNT_NOT_FOUND', 'NovaPay returned no active UAH account.')
    }
    if (activeUahAccounts.length > 1) {
      throw new HttpError(409, 'NOVAPAY_ACCOUNT_SELECTION_REQUIRED', 'NovaPay returned more than one active UAH account.', {
        accounts: activeUahAccounts.map((account) => ({
          id: finiteNumber(account.id, 'account id'),
          iban: text(account.IBAN || account.iban),
          currency: text(account.currency),
          status: text(account.statuscode || account.status),
        })),
      })
    }

    const account = activeUahAccounts[0]
    const accountId = finiteNumber(account.id, 'account id')
    const accountIban = normalizeIban(account.IBAN || account.iban)
    const balanceResult = await soapCall('GetAccountRest', {
      request_ref: requestRef(),
      jwt,
      account_id: accountId,
    }, true)

    const now = new Date()
    const fromDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const dateFrom = formatNovaDate(fromDate)
    const dateTo = formatNovaDate(now)
    const extractResult = await soapCall('GetAccountExtract', {
      request_ref: requestRef(),
      jwt,
      account_id: accountId,
      date_from: dateFrom,
      date_to: dateTo,
    }, true)

    const extractDocuments = parseNestedXmlCollection(extractResult.extract, 'Extract', 'Docs')
    const receipts = extractDocuments
      .filter((document) => isIncomingExtractDocument(document, accountIban))
      .map(extractReceipt)
      .filter((receipt) => receipt !== null)

    const available = finiteNumber(balanceResult.available_balance, 'available balance')
    const confirmed = finiteNumber(balanceResult.confirmed_balance, 'confirmed balance')
    const projected = finiteNumber(balanceResult.projected_balance, 'projected balance')
    const updatedAt = new Date().toISOString()
    const periodFrom = fromDate.toISOString()
    const periodTo = now.toISOString()
    const cachedAccount = {
      id: accountId,
      iban: accountIban,
      currency: text(account.currency),
      confirmed,
      projected,
    }

    await saveNewReceipts(admin, previousCache.receipts, receipts, Boolean(previousCache.updatedAt))

    const { error: cacheError } = await admin
      .from('bank_account_cache')
      .update({
        balance: available,
        updated_at: updatedAt,
        account: cachedAccount,
        receipts,
        period_from: periodFrom,
        period_to: periodTo,
      })
      .eq('bank', 'novapay')

    if (cacheError) throw new HttpError(500, 'BANK_CACHE_WRITE_FAILED', 'Failed to save NovaPay data.')
    const { error: cleanupError } = await admin.rpc('cleanup_bank_payment_events')
    if (cleanupError) throw new HttpError(500, 'BANK_PAYMENT_EVENT_CLEANUP_FAILED', 'Failed to clean up NovaPay payment events.')

    const diagnostics = extractDocuments.length > 0 && receipts.length === 0
      ? { documentCount: extractDocuments.length, sampleKeys: Object.keys(extractDocuments[0]).sort() }
      : undefined

    if (compact) return Response.json({ ok: true, refreshed: true, bank: 'novapay', balance: available, updatedAt })
    return Response.json({
      ok: true,
      refreshed: true,
      bank: 'novapay',
      balance: available,
      updatedAt,
      account: cachedAccount,
      receipts,
      period: { from: periodFrom, to: periodTo },
      ...(diagnostics ? { diagnostics } : {}),
    }, { headers: corsHeaders })
  } catch (error) {
    if (error instanceof NovaPayAuthError) {
      return errorResponse(new HttpError(error.status, error.code, error.message))
    }
    if (error instanceof NovaPayTransportError) {
      return errorResponse(new HttpError(502, 'NOVAPAY_TRANSPORT_ERROR', 'NovaPay is temporarily unreachable.'))
    }
    return errorResponse(error)
  }
})
