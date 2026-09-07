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

Deno.test('Nova CargoReturn promotes the live return TTN, status, destination and ETA', async () => {
  const originalFetch = globalThis.fetch
  const previousKey = Deno.env.get('NOVA_POSHTA_API_KEY')
  const responses = [
    {
      success: true,
      data: [
        {
          Number: '20451528497280',
          Status: 'Відмова від отримання',
          StatusCode: '102',
          CityRecipient: 'Київ',
          WarehouseRecipient: 'Відділення №343',
          CitySender: 'Циркуни',
          WarehouseSender: 'Відділення №1',
          LastCreatedOnTheBasisDocumentType: 'CargoReturn',
          LastCreatedOnTheBasisNumber: '59001764954977',
        },
      ],
    },
    { success: true, data: [] },
    {
      success: true,
      data: [
        {
          Number: '59001764954977',
          Status: 'Відправлення у с. Циркуни. Очікуйте повідомлення про прибуття',
          StatusCode: '6',
          DateScan: '16:12 07.09.2026',
          CitySender: 'Київ',
          WarehouseSender: 'Відділення №343',
          CityRecipient: 'Циркуни',
          WarehouseRecipient: 'Відділення №1',
          WarehouseRecipientNumber: '1',
          ScheduledDeliveryDate: '08-09-2026 15:00:00',
        },
      ],
    },
  ]
  Deno.env.set('NOVA_POSHTA_API_KEY', 'test-key')
  globalThis.fetch = async () =>
    new Response(JSON.stringify(responses.shift()), { status: 200 })
  try {
    const result = await novaStatus('20451528497280')
    assert(result.activeTtn === '59001764954977', 'CargoReturn TTN did not become current')
    assert(result.relation === 'return', 'CargoReturn TTN was not marked as a return')
    assert(
      result.status === 'Відправлення у с. Циркуни. Очікуйте повідомлення про прибуття',
      'live return status was not exposed',
    )
    assert(result.normalizedStatus === 'in_transit', 'live return movement was not normalized')
    assert(result.destination?.city === 'Циркуни', 'return TTN recipient city was not used')
    assert(result.destination?.address === 'Відділення №1', 'return TTN recipient branch was not used')
    assert(result.destination?.branchNumber === '1', 'return TTN recipient branch number was not used')
    assert(
      result.details?.trackingExpectedDeliveryAt === '08-09-2026 15:00:00',
      'return TTN ETA was not exposed',
    )
    assert(
      result.relatedShipments?.some((shipment) =>
        shipment.ttn === '59001764954977' &&
        shipment.relatedTtn === '20451528497280' &&
        shipment.relation === 'return'
      ),
      'CargoReturn relationship was not preserved',
    )
  } finally {
    globalThis.fetch = originalFetch
    if (previousKey) Deno.env.set('NOVA_POSHTA_API_KEY', previousKey)
    else Deno.env.delete('NOVA_POSHTA_API_KEY')
  }
})
