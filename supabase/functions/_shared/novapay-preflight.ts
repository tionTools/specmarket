import { NovaPayAuthError } from './novapay-auth.ts'

const NOVAPAY_WSDL_URL = 'https://business.novapay.ua/Services/ClientAPIService.svc?wsdl'
export const NOVAPAY_PREFLIGHT_TIMEOUT_MS = 8_000

function unavailable(reason: string) {
  return new NovaPayAuthError(
    503,
    'NOVAPAY_PREFLIGHT_UNAVAILABLE',
    'NovaPay availability check failed. Authorization was not attempted; retry on the next sync.',
    reason,
  )
}

// Read-only GET without the single-use refresh token. WSDL is not an auth health guarantee.
export async function checkNovaPayPreflight(
  request: typeof fetch = fetch,
  timeoutMs = NOVAPAY_PREFLIGHT_TIMEOUT_MS,
): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await request(NOVAPAY_WSDL_URL, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    })
    if (response.body) void response.body.cancel().catch(() => {})
    if (!response.ok) throw unavailable(`http_${response.status}`)
    if (!response.headers.get('content-type')?.toLowerCase().includes('xml'))
      throw unavailable('unexpected_content_type')
  } catch (error) {
    if (error instanceof NovaPayAuthError) throw error
    throw unavailable(controller.signal.aborted ? 'timeout' : 'transport_failure')
  } finally {
    clearTimeout(timer)
  }
}
