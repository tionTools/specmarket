import { meestStatus } from './meest.ts'
import { rozetkaStatus } from './rozetka-delivery.ts'
import { ukrposhtaStatus } from './ukrposhta.ts'
import { trackingChanged } from '../storage.ts'

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

async function withCarrierResponse(
  environment: Record<string, string>,
  body: unknown,
  run: () => Promise<void>,
) {
  const originalFetch = globalThis.fetch
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(environment)) {
    previous.set(key, Deno.env.get(key))
    Deno.env.set(key, value)
  }
  globalThis.fetch = async () => new Response(JSON.stringify(body))
  try {
    await run()
  } finally {
    globalThis.fetch = originalFetch
    for (const [key, value] of previous) {
      if (value) Deno.env.set(key, value)
      else Deno.env.delete(key)
    }
  }
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

Deno.test('ordinary Meest tracking still updates status', async () => {
  await withCarrierResponse({ MEEST_API_TOKEN: 'test' }, { result: [{
    eventDateTime: '2026-08-30 10:00:00', eventCode: '101', eventDescr: { descrUA: 'В дорозі' },
  }] }, async () => {
    const result = await meestStatus('M')
    assert(result.provider === 'meest_api', 'Meest endpoint changed')
    assert(trackingChanged({ ttn: 'M' }, result), 'ordinary Meest result no longer updates a legacy order')
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
