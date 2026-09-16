import { meestStatus } from './meest.ts'
import { rozetkaStatus } from './rozetka-delivery.ts'
import { ukrposhtaStatus } from './ukrposhta.ts'
import { trackingChanged } from '../storage.ts'

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

async function withCarrierResponses(
  environment: Record<string, string>,
  bodies: unknown[],
  run: () => Promise<void>,
) {
  const originalFetch = globalThis.fetch
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(environment)) {
    previous.set(key, Deno.env.get(key))
    Deno.env.set(key, value)
  }
  let responseIndex = 0
  globalThis.fetch = async () => {
    const body = bodies[Math.min(responseIndex, bodies.length - 1)]
    responseIndex += 1
    return new Response(JSON.stringify(body))
  }
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

async function withCarrierResponse(
  environment: Record<string, string>,
  body: unknown,
  run: () => Promise<void>,
) {
  await withCarrierResponses(environment, [body], run)
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

Deno.test('Meest falls back to public tracking when OpenAPI has no events', async () => {
  const publicStatus = 'Відправлення прийнято до перевезення в населеному пункті Харків'
  await withCarrierResponses({ MEEST_API_TOKEN: 'test' }, [
    {
      status: 'OK',
      info: { fieldName: '', message: '', messageDetails: '' },
      result: [],
    },
    { condition: publicStatus },
  ], async () => {
    const result = await meestStatus('723-3447567')
    assert(result.status === publicStatus, 'Meest public fallback must expose the actual public tracking status')
    assert(result.normalizedStatus === 'accepted', 'Meest accepted public status must be normalized as accepted')
    assert(result.final === false, 'Meest accepted public status must remain non-final')
    assert(result.provider === 'meest_public_tracking', 'Meest empty OpenAPI result must use public tracking fallback')
    assert(result.source === 'public_tracking', 'Meest fallback source must be marked as public tracking')
  })
})

Deno.test('Meest treats observed OK with empty result as created but not handed over', async () => {
  await withCarrierResponse({ MEEST_API_TOKEN: 'test' }, {
    status: 'OK',
    info: { fieldName: '', message: '', messageDetails: '' },
    result: [],
  }, async () => {
    const result = await meestStatus('723-3447567')
    assert(
      result.status === 'Отправление создано, но не передано на доставку',
      'Meest response OK must not be shown as shipment status',
    )
    assert(result.normalizedStatus === 'created', 'Meest empty result must remain created')
    assert(result.final === false, 'Meest empty result must remain non-final')
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
