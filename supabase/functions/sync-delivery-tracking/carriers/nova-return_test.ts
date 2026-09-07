import { novaStatus } from './nova-poshta.ts'

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

Deno.test('Nova refusal exposes return state, return destination and expected arrival', async () => {
  const originalFetch = globalThis.fetch
  const previousKey = Deno.env.get('NOVA_POSHTA_API_KEY')
  const responses = [
    {
      success: true,
      data: [
        {
          Status: 'Відмова від отримання',
          StatusCode: '102',
          CityRecipient: 'Циркуни',
          WarehouseRecipient: 'Відділення 1',
          WarehouseRecipientNumber: '1',
          ScheduledDeliveryDate: '08-09-2026 15:00:00',
        },
      ],
    },
    { success: true, data: [] },
  ]
  Deno.env.set('NOVA_POSHTA_API_KEY', 'test-key')
  globalThis.fetch = async () =>
    new Response(JSON.stringify(responses.shift()), { status: 200 })
  try {
    const result = await novaStatus('20451528497280')
    assert(result.normalizedStatus === 'returning', 'refusal did not become return in progress')
    assert(result.destination?.city === 'Циркуни', 'return city was not exposed')
    assert(result.destination?.address === 'Відділення 1', 'return branch was not exposed')
    assert(
      result.details?.trackingExpectedDeliveryAt === '08-09-2026 15:00:00',
      'expected return time was not exposed',
    )
  } finally {
    globalThis.fetch = originalFetch
    if (previousKey) Deno.env.set('NOVA_POSHTA_API_KEY', previousKey)
    else Deno.env.delete('NOVA_POSHTA_API_KEY')
  }
})
