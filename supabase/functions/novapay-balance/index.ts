import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { XMLParser } from 'npm:fast-xml-parser@5.11.1'
import {
  getValidNovaPayJwt,
  NovaPayAuthError,
  NovaPayTransportError,
} from '../_shared/novapay-auth.ts'

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

// NovaPay can encode PEM line breaks as numeric XML character references.
// fast-xml-parser only decodes those when htmlEntities is enabled.
const authParser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  htmlEntities: true,
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

const text = (value) => (typeof value === 'string' ? value.trim() : '')
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
    document = (method === 'UserAuthenticationJWT' ? authParser : parser).parse(responseText)
  } catch {
    throw new HttpError(502, 'NOVAPAY_SOAP_PARSE_ERROR', `NovaPay ${method} returned invalid XML.`)
  }

  const fault = findKey(document, 'Fault')
  if (fault !== undefined) {
    throw new HttpError(502, 'NOVAPAY_SOAP_FAULT', `NovaPay ${method} returned a SOAP fault.`)
  }

  const result = findKey(document, `${method}Result`)
  if (!isRecord(result)) {
    throw new HttpError(
      502,
      'NOVAPAY_SOAP_RESULT_MISSING',
      `NovaPay ${method} response is missing its result.`,
    )
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
  const number = Number(text(value))
  if (!Number.isFinite(number)) {
    throw new HttpError(502, 'NOVAPAY_INVALID_RESPONSE', `NovaPay returned invalid ${field}.`)
  }
  return number
}

function errorResponse(error) {
  if (error instanceof HttpError) {
    return Response.json(
      {
        ok: false,
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
      { status: error.status, headers: corsHeaders },
    )
  }
  console.error('NovaPay balance failed with an unexpected error.')
  return Response.json(
    { ok: false, code: 'NOVAPAY_INTERNAL_ERROR', message: 'NovaPay balance request failed.' },
    {
      status: 500,
      headers: corsHeaders,
    },
  )
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') {
    return Response.json(
      { ok: false, message: 'Method not allowed.' },
      { status: 405, headers: corsHeaders },
    )
  }

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const login = text(Deno.env.get('NOVAPAY_LOGIN'))
  const authorization = request.headers.get('Authorization')

  if (!url || !anonKey || !serviceKey || !login) {
    return Response.json(
      { ok: false, message: 'NovaPay configuration is incomplete.' },
      { status: 500, headers: corsHeaders },
    )
  }
  if (!authorization) {
    return Response.json(
      { ok: false, message: 'Unauthorized.' },
      { status: 401, headers: corsHeaders },
    )
  }

  const authClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
  })
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser()
  if (authError || !user || user.email?.toLowerCase() === 'guest@gmail.com') {
    return Response.json(
      { ok: false, message: 'Unauthorized.' },
      { status: 401, headers: corsHeaders },
    )
  }

  const admin = createClient(url, serviceKey)
  try {
    const jwt = await getValidNovaPayJwt({
      admin,
      authenticate: ({ refreshToken, publicCertificate }) =>
        soapCall('UserAuthenticationJWT', {
          request_ref: requestRef(),
          refresh_token: refreshToken,
          login,
          public_certificate: publicCertificate,
        }),
    })

    const clientsResult = await soapCall(
      'GetClientsList',
      {
        request_ref: requestRef(),
        jwt,
      },
      true,
    )
    const clients = normalizeCollection(clientsResult.clients, 'Clients')
    if (clients.length === 0) {
      throw new HttpError(
        502,
        'NOVAPAY_CLIENT_NOT_FOUND',
        'NovaPay returned no available enterprise.',
      )
    }
    if (clients.length > 1) {
      throw new HttpError(
        409,
        'NOVAPAY_CLIENT_SELECTION_REQUIRED',
        'NovaPay returned more than one enterprise.',
        {
          clients: clients.map((client) => ({
            id: finiteNumber(client.id, 'client id'),
            name: text(client.name),
            statecode: text(client.statecode),
          })),
        },
      )
    }

    const clientId = finiteNumber(clients[0].id, 'client id')
    const accountsResult = await soapCall(
      'GetAccountsList',
      {
        request_ref: requestRef(),
        jwt,
        client_id: clientId,
      },
      true,
    )
    const accounts = normalizeCollection(accountsResult.accounts, 'Accounts')
    const activeUahAccounts = accounts.filter((account) => {
      const currency = text(account.currency).toUpperCase()
      const statusCode = text(account.statuscode).toLowerCase()
      const status = text(account.status)
      return currency === 'UAH' && (statusCode === 'active' || status === '1')
    })

    if (activeUahAccounts.length === 0) {
      throw new HttpError(
        502,
        'NOVAPAY_ACCOUNT_NOT_FOUND',
        'NovaPay returned no active UAH account.',
      )
    }
    if (activeUahAccounts.length > 1) {
      throw new HttpError(
        409,
        'NOVAPAY_ACCOUNT_SELECTION_REQUIRED',
        'NovaPay returned more than one active UAH account.',
        {
          accounts: activeUahAccounts.map((account) => ({
            id: finiteNumber(account.id, 'account id'),
            iban: text(account.IBAN || account.iban),
            currency: text(account.currency),
            status: text(account.statuscode || account.status),
          })),
        },
      )
    }

    const account = activeUahAccounts[0]
    const accountId = finiteNumber(account.id, 'account id')
    const balanceResult = await soapCall(
      'GetAccountRest',
      {
        request_ref: requestRef(),
        jwt,
        account_id: accountId,
      },
      true,
    )

    return Response.json(
      {
        ok: true,
        account: {
          id: accountId,
          iban: text(account.IBAN || account.iban),
          currency: text(account.currency),
        },
        balance: {
          confirmed: finiteNumber(balanceResult.confirmed_balance, 'confirmed balance'),
          available: finiteNumber(balanceResult.available_balance, 'available balance'),
          projected: finiteNumber(balanceResult.projected_balance, 'projected balance'),
        },
      },
      { headers: corsHeaders },
    )
  } catch (error) {
    if (error instanceof NovaPayAuthError) {
      return errorResponse(new HttpError(error.status, error.code, error.message))
    }
    if (error instanceof NovaPayTransportError) {
      return errorResponse(
        new HttpError(502, 'NOVAPAY_TRANSPORT_ERROR', 'NovaPay is temporarily unreachable.'),
      )
    }
    return errorResponse(error)
  }
})
