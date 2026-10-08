import { NovaPayAuthError } from './novapay-auth.ts'
import { checkNovaPayPreflight } from './novapay-preflight.ts'

async function expectUnavailable(request: typeof fetch, expectedReason: string, timeoutMs = 8_000) {
  let failure: unknown
  try {
    await checkNovaPayPreflight(request, timeoutMs)
  } catch (error) {
    failure = error
  }
  if (
    !(failure instanceof NovaPayAuthError) ||
    failure.code !== 'NOVAPAY_PREFLIGHT_UNAVAILABLE' ||
    failure.status !== 503 ||
    failure.reason !== expectedReason
  ) {
    throw new Error('Unexpected preflight failure: ' + expectedReason)
  }
}

Deno.test('WSDL preflight is a credential-free noncached GET', async () => {
  let requests = 0
  const request: typeof fetch = async (input, init) => {
    requests++
    if (
      String(input) !== 'https://business.novapay.ua/Services/ClientAPIService.svc?wsdl' ||
      init?.method !== 'GET' ||
      init?.cache !== 'no-store' ||
      init?.redirect !== 'error' ||
      !init?.signal ||
      init?.headers !== undefined ||
      init?.body !== undefined
    ) {
      throw new Error('Availability request was not a credential-free WSDL GET')
    }
    return new Response('<definitions/>', {
      headers: { 'content-type': 'text/xml; charset=utf-8' },
    })
  }
  await checkNovaPayPreflight(request)
  if (requests !== 1) throw new Error('Unexpected repeated preflight')
})

Deno.test('preflight rejects NovaPay HTTP 503', async () => {
  const request: typeof fetch = async () => new Response('', { status: 503 })
  await expectUnavailable(request, 'http_503')
})

Deno.test('preflight rejects HTML or login response', async () => {
  const request: typeof fetch = async () =>
    new Response('<html/>', {
      headers: { 'content-type': 'text/html' },
    })
  await expectUnavailable(request, 'unexpected_content_type')
})

Deno.test('preflight classifies transport errors without leaking server text', async () => {
  const request: typeof fetch = async () => {
    throw new Error('PRIVATE_PROVIDER_RESPONSE')
  }
  await expectUnavailable(request, 'transport_failure')
})

Deno.test('preflight timeout aborts before credentials are used', async () => {
  const request: typeof fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener(
        'abort',
        () => reject(new DOMException('aborted', 'AbortError')),
        { once: true },
      )
    })
  await expectUnavailable(request, 'timeout', 5)
})
