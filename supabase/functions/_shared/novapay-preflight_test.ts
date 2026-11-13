import { NovaPayAuthError } from './novapay-auth.ts'
import { checkNovaPayPreflight, NOVAPAY_PREFLIGHT_TIMEOUT_MS } from './novapay-preflight.ts'

async function expectUnavailable(
  request: typeof fetch,
  expectedReason: string,
  timeoutMs = NOVAPAY_PREFLIGHT_TIMEOUT_MS,
) {
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
  const request: typeof fetch = (input, init) => {
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
    return Promise.resolve(
      new Response('<definitions/>', {
        headers: { 'content-type': 'text/xml; charset=utf-8' },
      }),
    )
  }
  await checkNovaPayPreflight(request)
  if (requests !== 1) throw new Error('Unexpected repeated preflight')
})

Deno.test('preflight rejects NovaPay HTTP 503', async () => {
  const request: typeof fetch = () => Promise.resolve(new Response('', { status: 503 }))
  await expectUnavailable(request, 'http_503')
})

Deno.test('preflight rejects HTML or login response', async () => {
  const request: typeof fetch = () =>
    Promise.resolve(
      new Response('<html/>', {
        headers: { 'content-type': 'text/html' },
      }),
    )
  await expectUnavailable(request, 'unexpected_content_type')
})

Deno.test('preflight classifies transport errors without leaking server text', async () => {
  const request: typeof fetch = () => Promise.reject(new Error('PRIVATE_PROVIDER_RESPONSE'))
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

Deno.test('preflight allows twelve seconds before timeout', () => {
  if (NOVAPAY_PREFLIGHT_TIMEOUT_MS !== 12_000) throw new Error('Unexpected preflight timeout')
})

Deno.test('preflight retries a transient HTTP 503 once without credentials', async () => {
  let attempts = 0
  const request: typeof fetch = (_input, init) => {
    attempts += 1
    if (init?.headers !== undefined || init?.body !== undefined) {
      throw new Error('Preflight must never include credentials')
    }
    if (attempts === 1) return Promise.resolve(new Response('', { status: 503 }))
    return Promise.resolve(
      new Response('<definitions/>', { headers: { 'content-type': 'text/xml' } }),
    )
  }
  await checkNovaPayPreflight(request)
  if (attempts !== 2) throw new Error('Preflight did not retry exactly once')
})

Deno.test('preflight retries a timed-out request with a new AbortSignal', async () => {
  let attempts = 0
  let oldSignal: AbortSignal | undefined
  const request: typeof fetch = (_input, init) => {
    attempts += 1
    const signal = init?.signal as AbortSignal
    if (attempts === 2) {
      if (signal === oldSignal || !oldSignal?.aborted || signal.aborted) {
        throw new Error('Each attempt must have a fresh AbortController')
      }
      return Promise.resolve(
        new Response('<definitions/>', {
          headers: { 'content-type': 'text/xml' },
        }),
      )
    }
    oldSignal = signal
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
        once: true,
      })
    })
  }
  await checkNovaPayPreflight(request, 5)
  if (attempts !== 2) throw new Error('Timeout was not retried exactly once')
})

Deno.test('preflight never makes a third attempt after two timeouts', async () => {
  let attempts = 0
  const request: typeof fetch = (_input, init) => {
    attempts += 1
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener(
        'abort',
        () => reject(new DOMException('aborted', 'AbortError')),
        { once: true },
      )
    })
  }
  await expectUnavailable(request, 'timeout', 5)
  if (attempts !== 2) throw new Error('Unexpected number of retries')
})

Deno.test('preflight does not retry malformed content or HTTP 404', async () => {
  for (const [response, reason] of [
    [
      () => new Response('<html/>', { headers: { 'content-type': 'text/html' } }),
      'unexpected_content_type',
    ],
    [() => new Response('', { status: 404 }), 'http_404'],
  ] as const) {
    let attempts = 0
    const request: typeof fetch = () => {
      attempts += 1
      return Promise.resolve(response())
    }
    await expectUnavailable(request, reason)
    if (attempts !== 1) throw new Error('Unexpected retry for non-retryable error')
  }
})
