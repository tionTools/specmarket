import { meestStatus } from './meest.ts'
import { rozetkaStatus } from './rozetka-delivery.ts'
import { ukrposhtaStatus } from './ukrposhta.ts'
import { trackingChanged } from '../storage.ts'

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

type MockResponse = { body: unknown; status?: number }
type FetchCall = { url: string; method: string }

async function withCarrierResponses(
  environment: Record<string, string>,
  responses: MockResponse[],
  run: (calls: FetchCall[]) => Promise<void>,
) {
  const originalFetch = globalThis.fetch
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(environment)) {
    previous.set(key, Deno.env.get(key))
    Deno.env.set(key, value)
  }
  const calls: FetchCall[] = []
  let responseIndex = 0
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url
    const method = init?.method || (input instanceof Request ? input.method : 'GET')
    calls.push({ url, method })
    const current = responses[responseIndex++]
    if (!current) throw new Error(`Unexpected fetch ${method} ${url}`)
    const body = typeof current.body === 'string' ? current.body : JSON.stringify(current.body)
    return new Response(body, { status: current.status ?? 200 })
  }
  try {
    await run(calls)
  } finally {
    globalThis.fetch = originalFetch
    for (const [key, value] of previous) {
      if (value) Deno.env.set(key, value)
      else Deno.env.delete(key)
    }
  }
}

async function withCarrierResponse(
  environment: Record<string, string>,
  body: unknown,
  run: (calls: FetchCall[]) => Promise<void>,
) {
  await withCarrierResponses(environment, [{ body }], run)
}

Deno.test('ordinary Ukrposhta tracking still updates status', async () => {
  await withCarrierResponse({ UKRPOSHTA_STATUS_BEARER: 'test' }, [{
    date: '2026-08-30 10:00:00', event: '10100', eventName: 'Прийнято', name: 'Відділення', index: '01001',
  }], async () => {
    const result = await ukrposhtaStatus('U')
    assert(result.provider === 'ukrposhta_status_api', 'Ukrposhta endpoint changed')
    assert(trackingChanged({ ttn: 'U' }, result), 'ordinary Ukrposhta result no longer updates a legacy order')
  })
})

Deno.test('ordinary Meest OpenAPI tracking stays primary and does not call public fallback', async () => {
  await withCarrierResponse({ MEEST_API_TOKEN: 'test' }, { result: [{
    eventDateTime: '2026-08-30 10:00:00', eventCode: '101', eventDescr: { descrUA: 'В дорозі' },
  }] }, async (calls) => {
    const result = await meestStatus('M')
    assert(result.provider === 'meest_api', 'Meest OpenAPI must remain the primary provider')
    assert(result.source === 'carrier_api', 'ordinary Meest result must remain carrier_api')
    assert(calls.length === 1, 'public tracking must not run when OpenAPI returned events')
    assert(trackingChanged({ ttn: 'M' }, result), 'ordinary Meest result no longer updates a legacy order')
  })
})

Deno.test('Meest empty OpenAPI result falls back to the signed public tracking used by the official site', async () => {
  const salt = '0123456789abcdef0123456789abcdef'
  const html = `<script>var salt = '${salt}';</script>`
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<return><result_table>
<items>
<DateTimeAction>2026-09-16 14:04:00</DateTimeAction><Country>УКРАЇНА</Country><City>Харків</City>
<StatusCode>2</StatusCode><ActionMessages>Відправлення створено, але не передано на доставку</ActionMessages><DetailMessages></DetailMessages>
</items>
<items>
<DateTimeAction>2026-09-16 19:04:19</DateTimeAction><Country>УКРАЇНА</Country><City>Харків</City>
<StatusCode>606</StatusCode><ActionMessages>Відправлення прийнято до перевезення</ActionMessages><DetailMessages>в населеному пункті Харків</DetailMessages>
</items>
</result_table></return>`
  await withCarrierResponses({ MEEST_API_TOKEN: 'test' }, [
    { body: { status: 'OK', result: [] } },
    { body: html },
    { body: xml },
  ], async (calls) => {
    const result = await meestStatus('723-3447567')
    assert(result.status === 'Відправлення прийнято до перевезення в населеному пункті Харків', 'public fallback must expose the latest actual event')
    assert(result.normalizedStatus === 'accepted', 'Meest code 606 must normalize as accepted')
    assert(result.final === false, 'accepted shipment must remain non-final')
    assert(result.provider === 'meest_public_tracking', 'empty OpenAPI must use public tracking provider')
    assert(result.source === 'public_tracking', 'fallback source must be public_tracking')
    assert(result.details?.trackingStatusCode === '606', 'latest public status code must be preserved')
    assert(result.details?.trackingEventAt === '2026-09-16 19:04:19', 'latest public event time must be preserved')
    assert(calls.length === 3, 'fallback must use OpenAPI, public page, then signed tracking request')
    assert(calls[1]?.url === 'https://t.meest-group.com/n/723-3447567', 'fallback must get the current public tracking salt')
    assert(calls[2]?.method === 'POST', 'public tracking endpoint must use the same POST method as the official site')
    assert(calls[2]?.url.includes('chk=4240e08ea27115c1064147ef96dd0f1e'), 'public request signature must be MD5(salt + TTN + salt)')
  })
})

Deno.test('Meest public fallback selects the newest public event instead of the obsolete created event', async () => {
  const html = `<script>var salt = '0123456789abcdef0123456789abcdef';</script>`
  const xml = `<return><result_table>
<items><DateTimeAction>2026-09-16 14:04:00</DateTimeAction><Country>УКРАЇНА</Country><City>Харків</City><StatusCode>2</StatusCode><ActionMessages>Відправлення створено, але не передано на доставку</ActionMessages><DetailMessages></DetailMessages></items>
<items><DateTimeAction>2026-09-16 19:04:19</DateTimeAction><Country>УКРАЇНА</Country><City>Харків</City><StatusCode>606</StatusCode><ActionMessages>Відправлення прийнято до перевезення</ActionMessages><DetailMessages>в населеному пункті Харків</DetailMessages></items>
<items><DateTimeAction>2026-09-17 16:41:59</DateTimeAction><Country>УКРАЇНА</Country><City>Харків</City><StatusCode>8081</StatusCode><ActionMessages>Відправлення в дорозі</ActionMessages><DetailMessages>в населений пункт Київ</DetailMessages></items>
</result_table></return>`
  await withCarrierResponses({ MEEST_API_TOKEN: 'test' }, [
    { body: { status: 'OK', result: [] } },
    { body: html },
    { body: xml },
  ], async () => {
    const result = await meestStatus('723-3447567')
    assert(result.status === 'Відправлення в дорозі в населений пункт Київ', 'fallback must use the newest public event')
    assert(result.normalizedStatus === 'in_transit', 'Meest code 8081 must normalize as in_transit')
    assert(result.details?.trackingStatusCode === '8081', 'latest status code must be 8081')
    assert(result.details?.trackingEventAt === '2026-09-17 16:41:59', 'latest event time must be selected')
    assert(result.events?.length === 3, 'public event history must be preserved')
  })
})

Deno.test('Meest empty OpenAPI and unusable public fallback fails instead of inventing a created status', async () => {
  await withCarrierResponses({ MEEST_API_TOKEN: 'test' }, [
    { body: { status: 'OK', result: [] } },
    { body: '<html><body>No tracking salt</body></html>' },
  ], async () => {
    let rejected = false
    try {
      await meestStatus('723-3447567')
    } catch (error) {
      rejected = error instanceof Error && /OpenAPI не вернул события; public tracking/.test(error.message)
    }
    assert(rejected, 'missing public tracking evidence must reject instead of returning a synthetic status')
  })
})

Deno.test('Rozetka Delivery keeps using public tracking', async () => {
  await withCarrierResponse({}, { data: {
    last_status: { id: '1', name: 'Створено', date: '2026-08-30 10:00:00' }, status_groups: [],
  } }, async () => {
    const result = await rozetkaStatus('R')
    assert(result.provider === 'rozetka_delivery_public_api', 'Rozetka public endpoint changed')
    assert(trackingChanged({ ttn: 'R' }, result), 'ordinary Rozetka result no longer updates a legacy order')
  })
})

Deno.test('Rozetka Delivery maps У відділенні to ready for pickup', async () => {
  await withCarrierResponse({}, { data: {
    last_status: { id: 'in-branch', name: 'У відділенні', date: '2026-09-03 20:00:00' }, status_groups: [],
  } }, async () => {
    const result = await rozetkaStatus('R-READY')
    assert(result.normalizedStatus === 'ready_for_pickup', 'Rozetka in-branch status must be ready_for_pickup')
    assert(result.final === false, 'Rozetka in-branch status must remain non-final')
    assert(result.status === 'У відділенні', 'Rozetka source status should stay visible')
  })
})
