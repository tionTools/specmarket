import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { XMLParser } from 'npm:fast-xml-parser@5.11.1'
import { getValidNovaPayJwt, NovaPayAuthError, NovaPayTransportError } from '../_shared/novapay-auth.ts'

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
  let responseText
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
    responseText = await response.text()
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
    document = parser.parse(responseText)
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

  if (method === 'UserAuthenticationJWT') {
    const responseRef = text(result.response_ref)
    console.info(`NovaPay auth response_ref: ${responseRef || 'missing'}`)
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
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
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

function collectNestedRecords(value, itemName, records = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectNestedRecords(item, itemName, records)
    return records
  }
  if (!isRecord(value)) return records

  if (Object.prototype.hasOwnProperty.call(value, itemName)) {
    const items = value[itemName]
    if (Array.isArray(items)) records.push(...items.filter(isRecord))
    else if (isRecord(items)) records.push(items)
  }

  for (const [key, child] of Object.entries(value)) {
    if (key !== itemName) collectNestedRecords(child, itemName, records)
  }
  return records
}

function parsePaymentsDocuments(rawXml) {
  const xml = text(rawXml)
  if (!xml) return []

  let document
  try {
    document = parser.parse(xml)
  } catch {
    throw new HttpError(502, 'NOVAPAY_NESTED_XML_PARSE_ERROR', 'NovaPay Payments XML is invalid.')
  }

  const root = findKey(document, 'Payments')
  if (!isRecord(root)) return []
  return collectNestedRecords(root, 'Docs').map(normalizeXmlRecord)
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

function isIncomingPaymentDocument(document, accountIban) {
  const creditIban = normalizeIban(pick(document, 'CreditCodeIBAN', 'CreditIBAN', 'creditIBAN'))
  return Boolean(accountIban) && creditIban === accountIban
}

function isConductedPaymentDocument(document) {
  return pick(document, 'StatusDocumentId') === '8'
}

function parseNovaDateTime(value) {
  const raw = text(value)
  const match = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(raw)
  if (!match) return null

  const day = Number(match[1])
  const month = Number(match[2])
  const year = Number(match[3])
  const hours = Number(match[4])
  const minutes = Number(match[5])
  const seconds = Number(match[6] ?? 0)

  if (
    month < 1 || month > 12 ||
    hours < 0 || hours > 23 ||
    minutes < 0 || minutes > 59 ||
    seconds < 0 || seconds > 59
  ) return null

  const calendarProbe = new Date(Date.UTC(year, month - 1, day))
  if (
    calendarProbe.getUTCFullYear() !== year ||
    calendarProbe.getUTCMonth() !== month - 1 ||
    calendarProbe.getUTCDate() !== day
  ) return null

  return {
    raw,
    date: `${match[1]}.${match[2]}.${match[3]}`,
    time: `${match[4]}:${match[5]}:${String(seconds).padStart(2, '0')}`,
  }
}

function extractReceipt(document) {
  const amount = optionalNumber(pick(document, 'Amount', 'CrncyCredit', 'CreditAmount', 'Credit', 'SumCredit'))
  if (amount === null || amount <= 0) return null

  const changedAt = parseNovaDateTime(pick(document, 'Changed'))
  const createdAt = parseNovaDateTime(pick(document, 'Created'))
  const eventDateTime = changedAt ?? createdAt
  const paymentDate = pick(document, 'DayDate', 'OrgDate', 'PaymentDate', 'Date', 'date')
  const debitIban = normalizeIban(pick(document, 'DebitCodeIBAN', 'DebitIBAN', 'debitIBAN'))
  const creditIban = normalizeIban(pick(document, 'CreditCodeIBAN', 'CreditIBAN', 'creditIBAN'))
  const providerId = pick(document, 'ID', 'id')
  const uetr = pick(document, 'UETR')
  const paymentCode = pick(document, 'Code')
  const providerAliases = [
    providerId ? `id:${providerId}` : '',
    uetr ? `uetr:${uetr}` : '',
  ].filter(Boolean)

  return {
    id: providerAliases[0] ?? '',
    providerAliases,
    paymentCode,
    date: eventDateTime?.raw ?? paymentDate,
    occurredAt: eventDateTime ? receiptOccurredAt(eventDateTime.date, eventDateTime.time) : '',
    description: pick(document, 'DebitName', 'PayerName', 'SenderName', 'Description'),
    amount,
    balance: null,
    comment: pick(document, 'Purpose', 'Comment', 'Description'),
    legacyDate: paymentDate,
    legacyCreatedDate: createdAt?.date ?? '',
    legacyChangedDate: changedAt?.date ?? '',
    stableDebitIban: debitIban,
    stableCreditIban: creditIban,
    eventKnown: false,
  }
}

function kyivDateTimeParts(utcMs) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(utcMs))
  const part = (type) => parts.find((item) => item.type === type)?.value ?? ''
  return {
    year: Number(part('year')),
    month: Number(part('month')),
    day: Number(part('day')),
    hours: Number(part('hour')),
    minutes: Number(part('minute')),
    seconds: Number(part('second')),
  }
}

function kyivOffsetMs(utcMs) {
  const local = kyivDateTimeParts(utcMs)
  return Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hours,
    local.minutes,
    local.seconds,
  ) - utcMs
}

function receiptOccurredAt(dayDate, dayTime) {
  const dateMatch = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(dayDate)
  const timeMatch = /^(\d{2}):(\d{2}):(\d{2})$/.exec(dayTime)
  if (!dateMatch || !timeMatch) return ''

  const day = Number(dateMatch[1])
  const month = Number(dateMatch[2])
  const year = Number(dateMatch[3])
  const hours = Number(timeMatch[1])
  const minutes = Number(timeMatch[2])
  const seconds = Number(timeMatch[3])
  const localAsUtc = Date.UTC(year, month - 1, day, hours, minutes, seconds)

  let offset = kyivOffsetMs(localAsUtc)
  let utcMs = localAsUtc - offset
  const correctedOffset = kyivOffsetMs(utcMs)
  if (correctedOffset !== offset) {
    offset = correctedOffset
    utcMs = localAsUtc - offset
  }

  const local = kyivDateTimeParts(utcMs)
  if (
    local.year !== year ||
    local.month !== month ||
    local.day !== day ||
    local.hours !== hours ||
    local.minutes !== minutes ||
    local.seconds !== seconds
  ) return ''

  const value = new Date(utcMs)
  return Number.isFinite(value.getTime()) ? value.toISOString() : ''
}

function receiptSortTimestamp(receipt) {
  const occurredAt = Date.parse(text(receipt?.occurredAt))
  if (Number.isFinite(occurredAt)) return occurredAt

  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text(receipt?.legacyDate))
  if (!match) return Number.NEGATIVE_INFINITY
  return Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]))
}

function sortReceiptsNewestFirst(receipts) {
  return [...receipts].sort((left, right) =>
    receiptSortTimestamp(right) - receiptSortTimestamp(left)
  )
}

function receiptCalendarDate(receipt) {
  const match = /^(\d{2}\.\d{2}\.\d{4})/.exec(text(receipt?.date))
  if (match) return match[1]

  const occurredAt = Date.parse(text(receipt?.occurredAt))
  return Number.isFinite(occurredAt) ? formatNovaDate(new Date(occurredAt)) : ''
}

function normalizedLegacyText(value) {
  return text(value).replace(/\s+/g, ' ')
}

function receiptProviderAliases(receipt) {
  if (!Array.isArray(receipt?.providerAliases)) return []
  return [...new Set(receipt.providerAliases.map(text).filter(Boolean))]
}

function receiptStableSignature(receipt) {
  const stableDate = text(receipt?.legacyDate)
  if (!stableDate) return ''

  const amount = Number(receipt?.amount)
  return [
    stableDate,
    normalizedLegacyText(receipt?.paymentCode),
    Number.isFinite(amount) ? amount.toFixed(2) : '',
    normalizeIban(receipt?.stableDebitIban),
    normalizeIban(receipt?.stableCreditIban),
    normalizedLegacyText(receipt?.description),
    normalizedLegacyText(receipt?.comment),
  ].join('\u0000')
}

async function receiptExternalId(receipt) {
  const providerIdentity = receiptProviderAliases(receipt)[0]
  if (providerIdentity) return providerIdentity

  const stableSignature = receiptStableSignature(receipt)
  if (!stableSignature) return ''

  const source = `novapay-fallback\u0000${stableSignature}`
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source))
  return `hash:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function receiptLegacySignature(receipt, date = receiptCalendarDate(receipt)) {
  const amount = Number(receipt?.amount)
  return [
    text(date),
    Number.isFinite(amount) ? amount.toFixed(2) : '',
    normalizedLegacyText(receipt?.description),
    normalizedLegacyText(receipt?.comment),
  ].join('\u0000')
}

function newReceiptLegacyDates(receipt) {
  return [...new Set([
    text(receipt?.legacyDate),
    text(receipt?.legacyCreatedDate),
    text(receipt?.legacyChangedDate),
  ].filter(Boolean))]
}

async function saveNewReceipts(admin, previousReceipts, receipts, hasBaseline, useLegacyMatcher) {
  if (!hasBaseline) return

  const { data: existingEvents, error: existingEventsError } = await admin
    .from('bank_payment_events')
    .select('external_id')
    .eq('bank', 'novapay')
  if (existingEventsError) {
    throw new HttpError(500, 'BANK_PAYMENT_EVENT_READ_FAILED', 'Failed to read existing NovaPay payment events.')
  }

  const knownExact = new Set(
    (existingEvents ?? []).map((event) => text(event.external_id)).filter(Boolean),
  )
  const knownStableWithoutProvider = new Map()

  for (const receipt of previousReceipts) {
    if (!text(receipt?.occurredAt) && receipt?.eventKnown !== true) continue

    const externalId = await receiptExternalId(receipt)
    if (externalId) knownExact.add(externalId)
    for (const alias of receiptProviderAliases(receipt)) knownExact.add(alias)

    if (receiptProviderAliases(receipt).length === 0) {
      const stableSignature = receiptStableSignature(receipt)
      if (stableSignature) {
        knownStableWithoutProvider.set(
          stableSignature,
          (knownStableWithoutProvider.get(stableSignature) ?? 0) + 1,
        )
      }
    }
  }

  const legacyCounts = new Map()
  if (useLegacyMatcher) {
    for (const receipt of previousReceipts) {
      const signature = receiptLegacySignature(receipt)
      legacyCounts.set(signature, (legacyCounts.get(signature) ?? 0) + 1)
    }
  }

  const candidates = await Promise.all(receipts.map(async (receipt) => ({
    receipt,
    aliases: receiptProviderAliases(receipt),
    externalId: await receiptExternalId(receipt),
    stableSignature: receiptStableSignature(receipt),
  })))
  const handled = new Set()

  // Exact provider identities are authoritative. UETR acts as a safe alias if an ID changes.
  for (const candidate of candidates) {
    const exactMatch =
      Boolean(candidate.externalId && knownExact.has(candidate.externalId)) ||
      candidate.aliases.some((alias) => knownExact.has(alias))
    if (!exactMatch) continue

    if (candidate.aliases.length === 0 && candidate.stableSignature) {
      const stableKnownCount = knownStableWithoutProvider.get(candidate.stableSignature) ?? 0
      if (stableKnownCount > 0) {
        knownStableWithoutProvider.set(candidate.stableSignature, stableKnownCount - 1)
      }
    }

    candidate.receipt.eventKnown = true
    handled.add(candidate.receipt)
  }

  // Cross-identity stable matching is allowed only when the previous known receipt had
  // no provider identity at all. Never suppress id:111 with id:222 only by similarity.
  for (const candidate of [...candidates].reverse()) {
    if (handled.has(candidate.receipt) || !candidate.stableSignature) continue

    const stableKnownCount = knownStableWithoutProvider.get(candidate.stableSignature) ?? 0
    if (stableKnownCount <= 0) continue

    knownStableWithoutProvider.set(candidate.stableSignature, stableKnownCount - 1)
    candidate.receipt.eventKnown = true
    handled.add(candidate.receipt)
  }

  if (useLegacyMatcher) {
    for (const candidate of [...candidates].reverse()) {
      if (handled.has(candidate.receipt)) continue

      for (const date of newReceiptLegacyDates(candidate.receipt)) {
        const signature = receiptLegacySignature(candidate.receipt, date)
        const legacyCount = legacyCounts.get(signature) ?? 0
        if (legacyCount <= 0) continue

        legacyCounts.set(signature, legacyCount - 1)
        candidate.receipt.eventKnown = true
        handled.add(candidate.receipt)
        break
      }
    }
  }

  for (const candidate of [...candidates].reverse()) {
    if (
      handled.has(candidate.receipt) ||
      !candidate.externalId ||
      !candidate.receipt.occurredAt
    ) continue

    const { error } = await admin.from('bank_payment_events').upsert({
      bank: 'novapay', external_id: candidate.externalId, occurred_at: candidate.receipt.occurredAt,
      amount: candidate.receipt.amount, balance: candidate.receipt.balance,
      payer: text(candidate.receipt.description) || text(candidate.receipt.comment),
      description: text(candidate.receipt.description), comment: text(candidate.receipt.comment),
    }, { onConflict: 'bank,external_id', ignoreDuplicates: true })
    if (error) throw new HttpError(500, 'BANK_PAYMENT_EVENT_WRITE_FAILED', 'Failed to save NovaPay payment event.')

    candidate.receipt.eventKnown = true
    handled.add(candidate.receipt)
    knownExact.add(candidate.externalId)
    for (const alias of candidate.aliases) knownExact.add(alias)
  }
}

function formatNovaDate(date) {
  const parts = new Intl.DateTimeFormat('uk-UA', {
    timeZone: 'Europe/Kyiv',
    day: '2-digit', month: '2-digit', year: 'numeric',
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
    receipts: Array.isArray(row.receipts) ? sortReceiptsNewestFirst(row.receipts) : [],
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

  const admin = createClient(url, serviceKey)
  const { data: cronSecret } = await admin.rpc('get_crm_sync_cron_secret')
  const isScheduledRequest = typeof cronSecret === 'string' && authorization === `Bearer ${cronSecret}`

  const authClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } })
  const authResult = isScheduledRequest
    ? { data: { user: null }, error: null }
    : await authClient.auth.getUser()
  const { data: { user }, error: authError } = authResult
  if (!isScheduledRequest && (authError || !user || user.email?.toLowerCase() === 'guest@gmail.com')) {
    return Response.json({ ok: false, message: 'Unauthorized.' }, { status: 401, headers: corsHeaders })
  }

  let body = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  const refresh = isScheduledRequest || (isRecord(body) && body.refresh === true)
  const compact = isScheduledRequest || (isRecord(body) && body.compact === true)

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
      authenticate: ({ refreshToken, publicCertificate }) => {
        const authRequestRef = requestRef()
        console.info(`NovaPay auth request_ref: ${authRequestRef}`)
        return soapCall('UserAuthenticationJWT', {
          request_ref: authRequestRef,
          refresh_token: refreshToken,
          login,
          public_certificate: publicCertificate,
        })
      },
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
    const previousUpdatedAt = Date.parse(text(previousCache.updatedAt))
    const updatedFromDate = Number.isFinite(previousUpdatedAt)
      ? new Date(Math.min(now.getTime(), Math.max(previousUpdatedAt, fromDate.getTime())))
      : fromDate
    const updatedDateFrom = formatNovaDate(updatedFromDate)
    const statementPaymentsResult = await soapCall('GetPaymentsList', {
      request_ref: requestRef(),
      jwt,
      account_id: accountId,
      date_from: dateFrom,
      date_to: dateTo,
      date_type: 0,
    }, true)
    const updatedPaymentsResult = await soapCall('GetPaymentsList', {
      request_ref: requestRef(),
      jwt,
      account_id: accountId,
      date_from: updatedDateFrom,
      date_to: dateTo,
      date_type: 3,
    }, true)

    const statementDocuments = parsePaymentsDocuments(statementPaymentsResult.payments)
    const statementConductedDocuments = statementDocuments.filter(isConductedPaymentDocument)
    const statementIncomingDocuments = statementConductedDocuments.filter((document) =>
      isIncomingPaymentDocument(document, accountIban)
    )
    const receipts = sortReceiptsNewestFirst(statementIncomingDocuments
      .map(extractReceipt)
      .filter((receipt) => receipt !== null))

    const updatedDocuments = parsePaymentsDocuments(updatedPaymentsResult.payments)
    const updatedConductedDocuments = updatedDocuments.filter(isConductedPaymentDocument)
    const updatedIncomingDocuments = updatedConductedDocuments.filter((document) =>
      isIncomingPaymentDocument(document, accountIban)
    )
    const updatedReceipts = sortReceiptsNewestFirst(updatedIncomingDocuments
      .map(extractReceipt)
      .filter((receipt) => receipt !== null))

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
      receiptSource: 'payments-list-v1',
    }

    const useLegacyMatcher = previousCache.account?.receiptSource !== 'payments-list-v1'
    const hasBaseline = Boolean(previousCache.updatedAt)
    await saveNewReceipts(
      admin,
      previousCache.receipts,
      receipts,
      hasBaseline,
      useLegacyMatcher,
    )
    await saveNewReceipts(
      admin,
      receipts,
      updatedReceipts,
      hasBaseline,
      false,
    )

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

    const timedCount = receipts.filter((receipt) => Boolean(text(receipt?.occurredAt))).length
    const eventKnownCount = receipts.filter((receipt) => receipt?.eventKnown === true).length
    const providerIdentifiedCount = receipts.filter((receipt) =>
      receiptProviderAliases(receipt).length > 0
    ).length
    const fallbackIdentityCount = receipts.filter((receipt) =>
      receiptProviderAliases(receipt).length === 0 && Boolean(receiptStableSignature(receipt))
    ).length
    const updatedTimedCount = updatedReceipts.filter((receipt) => Boolean(text(receipt?.occurredAt))).length
    const updatedEventKnownCount = updatedReceipts.filter((receipt) => receipt?.eventKnown === true).length
    const updatedProviderIdentifiedCount = updatedReceipts.filter((receipt) =>
      receiptProviderAliases(receipt).length > 0
    ).length
    const updatedFallbackIdentityCount = updatedReceipts.filter((receipt) =>
      receiptProviderAliases(receipt).length === 0 && Boolean(receiptStableSignature(receipt))
    ).length

    if (fallbackIdentityCount > 0 || updatedFallbackIdentityCount > 0) {
      console.warn(
        `NovaPay conducted payments without ID/UETR: statement=${fallbackIdentityCount} updated=${updatedFallbackIdentityCount}`,
      )
    }

    const diagnostics = statementDocuments.length > 0 || updatedDocuments.length > 0
      ? {
          statement: {
            documentCount: statementDocuments.length,
            conductedCount: statementConductedDocuments.length,
            incomingCount: statementIncomingDocuments.length,
            timedCount,
            eventKnownCount,
            providerIdentifiedCount,
            fallbackIdentityCount,
            sampleKeys: Object.keys(statementDocuments[0] ?? {}).sort(),
          },
          updated: {
            documentCount: updatedDocuments.length,
            conductedCount: updatedConductedDocuments.length,
            incomingCount: updatedIncomingDocuments.length,
            timedCount: updatedTimedCount,
            eventKnownCount: updatedEventKnownCount,
            providerIdentifiedCount: updatedProviderIdentifiedCount,
            fallbackIdentityCount: updatedFallbackIdentityCount,
            sampleKeys: Object.keys(updatedDocuments[0] ?? {}).sort(),
          },
        }
      : undefined
    console.info(
      `NovaPay payments diagnostics: statement ${dateFrom}..${dateTo} documents=${statementDocuments.length} conducted=${statementConductedDocuments.length} incoming=${statementIncomingDocuments.length} timed=${timedCount} eventKnown=${eventKnownCount} providerId=${providerIdentifiedCount} fallbackId=${fallbackIdentityCount}; updated ${updatedDateFrom}..${dateTo} documents=${updatedDocuments.length} conducted=${updatedConductedDocuments.length} incoming=${updatedIncomingDocuments.length} timed=${updatedTimedCount} eventKnown=${updatedEventKnownCount} providerId=${updatedProviderIdentifiedCount} fallbackId=${updatedFallbackIdentityCount}`,
    )

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