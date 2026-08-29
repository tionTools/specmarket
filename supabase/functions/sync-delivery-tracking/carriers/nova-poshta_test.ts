import { novaStatus } from './nova-poshta.ts'

type NovaPayload = { status?: number; body?: unknown; error?: Error }

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

function payload(data: unknown): NovaPayload {
  return { body: { success: true, data: Array.isArray(data) ? data : [data] } }
}

async function withNovaResponses(
  responses: NovaPayload[],
  run: (calls: string[], requests: Array<{ modelName: string; calledMethod: string; methodProperties: Record<string, unknown> }>) => Promise<void>,
) {
  const originalFetch = globalThis.fetch
  const previousKey = Deno.env.get('NOVA_POSHTA_API_KEY')
  const calls: string[] = []
  const requests: Array<{ modelName: string; calledMethod: string; methodProperties: Record<string, unknown> }> = []
  Deno.env.set('NOVA_POSHTA_API_KEY', 'test-key')
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { modelName: string; calledMethod: string }
    calls.push(`${request.modelName}.${request.calledMethod}`)
    requests.push(request as { modelName: string; calledMethod: string; methodProperties: Record<string, unknown> })
    const next = responses.shift()
    if (!next) throw new Error('Unexpected Nova request')
    if (next.error) throw next.error
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 })
  }
  try {
    await run(calls, requests)
  } finally {
    globalThis.fetch = originalFetch
    if (previousKey) Deno.env.set('NOVA_POSHTA_API_KEY', previousKey)
    else Deno.env.delete('NOVA_POSHTA_API_KEY')
  }
}

const shipmentA = { Status: 'В дорозі', StatusCode: '101', CityRecipient: 'Київ', WarehouseRecipient: 'Відділення 1' }
const shipmentB = { Status: 'В дорозі', StatusCode: '101', CityRecipient: 'Львів', WarehouseRecipient: 'Відділення 2' }

Deno.test('ordinary Nova tracking keeps its base status and uses a DocumentNumber redirect lookup', async () => {
  await withNovaResponses([payload(shipmentA), payload([])], async (calls, requests) => {
    const result = await novaStatus('A')
    assert(result.status === shipmentA.Status, 'base Nova status changed')
    assert(result.activeTtn === 'A', 'ordinary shipment changed its TTN')
    assert(calls.join(',') === 'TrackingDocument.getStatusDocuments,AdditionalService.getRedirectionOrdersList', 'unexpected Nova flow')
    assert(requests[1]?.methodProperties.DocumentNumber === 'A', 'redirect lookup did not use DocumentNumber')
  })
})

Deno.test('a failed redirection lookup does not fail base Nova tracking', async () => {
  await withNovaResponses([payload(shipmentA), { body: { success: false, errors: ['unavailable'] } }], async () => {
    const result = await novaStatus('A')
    assert(result.activeTtn === 'A', 'failed redirect lookup changed active TTN')
    assert(result.status === shipmentA.Status, 'failed redirect lookup changed base status')
    assert(Boolean(result.details?.trackingRedirectLookupError), 'redirect error was not recorded')
  })
})

Deno.test('a failed redirect lookup opens the run circuit without skipping later base tracking', async () => {
  await withNovaResponses([
    payload(shipmentA),
    { body: { success: false, errors: ['unavailable'] } },
    payload(shipmentB),
    payload(shipmentA),
    payload([]),
  ], async (calls) => {
    const circuit = { failed: false }
    const first = await novaStatus('A', circuit)
    const second = await novaStatus('B', circuit)
    const nextRun = await novaStatus('C', { failed: false })
    assert(first.activeTtn === 'A' && second.activeTtn === 'B', 'circuit broke base tracking')
    assert(nextRun.activeTtn === 'C', 'new run did not retain base tracking')
    assert(
      calls.join(',') === [
        'TrackingDocument.getStatusDocuments',
        'AdditionalService.getRedirectionOrdersList',
        'TrackingDocument.getStatusDocuments',
        'TrackingDocument.getStatusDocuments',
        'AdditionalService.getRedirectionOrdersList',
      ].join(','),
      'redirect circuit did not skip the failed enrichment for the rest of the run',
    )
  })
})

Deno.test('a failed status request for redirected TTN keeps the base shipment active', async () => {
  await withNovaResponses([
    payload(shipmentA),
    payload({ DocumentNumber: 'A', ExpressWaybillNumber: 'B', CityRecipient: 'Львів', RecipientAddress: 'Відділення 2' }),
    { error: new Error('new TTN unavailable') },
  ], async () => {
    const result = await novaStatus('A')
    assert(result.activeTtn === 'A', 'unconfirmed redirected TTN became active')
    assert(result.status === shipmentA.Status, 'base status was lost after redirect enrichment failure')
  })
})

Deno.test('a confirmed Nova redirect promotes the new TTN', async () => {
  await withNovaResponses([
    payload(shipmentA),
    payload({ DocumentNumber: 'A', ExpressWaybillNumber: 'B', CityRecipient: 'Львів', RecipientAddress: 'Відділення 2' }),
    payload(shipmentB),
    payload([]),
  ], async () => {
    const result = await novaStatus('A')
    assert(result.activeTtn === 'B', 'confirmed redirected TTN did not become active')
    assert(result.relatedShipments?.some((shipment) => shipment.relation === 'redirect' && shipment.ttn === 'B'), 'redirect relation missing')
  })
})

Deno.test('a delivered redirected TTN determines the delivery status', async () => {
  await withNovaResponses([
    payload(shipmentA),
    payload({ DocumentNumber: 'A', ExpressWaybillNumber: 'B' }),
    payload({ ...shipmentB, Status: 'Отримано', StatusCode: '9' }),
    payload([]),
  ], async () => {
    const result = await novaStatus('A')
    assert(result.activeTtn === 'B', 'redirected TTN did not remain current')
    assert(result.normalizedStatus === 'delivered', 'original TTN blocked the delivered redirected TTN')
  })
})

Deno.test('LightReturnNumber remains a return relation', async () => {
  await withNovaResponses([
    payload({ ...shipmentA, LightReturnNumber: 'A' }),
    payload([]),
  ], async () => {
    const result = await novaStatus('B')
    assert(result.relation === 'return', 'LightReturnNumber was classified as redirect')
    assert(result.relatedShipments?.some((shipment) => shipment.relation === 'return'), 'return relation missing')
  })
})
