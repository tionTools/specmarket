import { novaStatus } from './nova-poshta.ts'

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

Deno.test('Nova refusal exposes sender as return destination and expected arrival', async () => {
  const originalFetch = globalThis.fetch
  const previousKey = Deno.env.get('NOVA_POSHTA_API_KEY')
  const responses = [
    {
      success: true,
      data: [
        {
          Status: 'Відмова від отримання',
          StatusCode: '102',
          CityRecipient: 'Київ',
          WarehouseRecipient: 'Відділення №343',
          WarehouseRecipientNumber: '343',
          CitySender: 'Циркуни',
          WarehouseSender: 'Відділення №1',
          WarehouseSenderNumber: '1',
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
    assert(result.destination?.city === 'Циркуни', 'return target did not use sender city')
    assert(result.destination?.address === 'Відділення №1', 'return target did not use sender branch')
    assert(result.destination?.branchNumber === '1', 'return target branch number was not exposed')
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
