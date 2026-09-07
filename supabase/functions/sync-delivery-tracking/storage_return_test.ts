import { mergeTrackingDelivery, trackingChanged } from './storage.ts'
import { record } from './normalize.ts'
import type { JsonRecord, TrackingResult } from './types.ts'

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

const depotResult: TrackingResult = {
  status: 'Прибула в депо 4',
  final: false,
  normalizedStatus: 'in_transit',
  provider: 'nova_poshta_api',
  source: 'carrier_api',
  destination: {
    city: 'Київ',
    address: 'Відділення №343',
    branchNumber: '343',
  },
}

Deno.test('return keeps its stage and destination while raw carrier checkpoint advances', () => {
  const delivery: JsonRecord = {
    ttn: '20451528497280',
    carrier: 'Новая почта',
    city: 'Циркуни',
    address: 'Відділення №1',
    trackingDestinationBranchNumber: '1',
    trackingStatus: 'Відмова від отримання',
    trackingNormalizedStatus: 'returning',
    shipmentHistory: [
      {
        ttn: '20451528497280',
        carrier: 'Новая почта',
        relation: 'original',
        city: 'Київ',
        address: 'Відділення №343',
        source: 'marketplace',
        firstSeenAt: '2026-09-05T15:03:54Z',
        lastSeenAt: '2026-09-06T14:58:08Z',
      },
    ],
  }

  assert(trackingChanged(delivery, depotResult), 'new depot checkpoint was ignored')
  const next = mergeTrackingDelivery(delivery, depotResult, '2026-09-07T16:03:43Z')
  assert(next.trackingStatus === 'Прибула в депо 4', 'raw current checkpoint was not stored')
  assert(next.trackingNormalizedStatus === 'in_transit', 'current movement status was not stored')
  assert(next.trackingReturnInProgress === true, 'return stage was lost after the refusal checkpoint')
  assert(next.city === 'Циркуни', 'return destination city regressed to the original recipient')
  assert(next.address === 'Відділення №1', 'return destination branch regressed to the original recipient')
  assert(
    next.trackingDestinationBranchNumber === '1',
    'return destination branch number regressed to the original recipient',
  )
  assert(!trackingChanged(next, depotResult), 'unchanged depot checkpoint would cause repeated writes')
})

Deno.test('return flag is cleared when the carrier reports a terminal return delivery', () => {
  const delivery: JsonRecord = {
    ttn: '20451528497280',
    carrier: 'Новая почта',
    city: 'Циркуни',
    address: 'Відділення №1',
    trackingStatus: 'Прибула в депо 4',
    trackingNormalizedStatus: 'in_transit',
    trackingReturnInProgress: true,
  }
  const delivered: TrackingResult = {
    status: 'Отримано',
    final: true,
    normalizedStatus: 'delivered',
    destination: { city: 'Київ', address: 'Відділення №343' },
  }
  const next = mergeTrackingDelivery(delivery, delivered, '2026-09-08T12:00:00Z')
  assert(next.trackingReturnInProgress === false, 'terminal delivery kept the return-in-progress flag')
  assert(next.city === 'Циркуни', 'terminal return changed the return destination back to recipient')
})

Deno.test('CargoReturn relation promotes the return TTN and return destination from stale refusal data', () => {
  const delivery: JsonRecord = {
    ttn: '20451528497280',
    carrier: 'Новая почта',
    city: 'Київ',
    address: 'Відділення №343',
    trackingDestinationBranchNumber: '343',
    trackingStatus: 'Відмова від отримання',
    trackingNormalizedStatus: 'cancelled',
  }
  const liveReturn: TrackingResult = {
    status: 'Відправлення у с. Циркуни. Очікуйте повідомлення про прибуття',
    final: false,
    normalizedStatus: 'in_transit',
    provider: 'nova_poshta_api',
    source: 'carrier_api',
    activeTtn: '59001764954977',
    relation: 'return',
    destination: {
      city: 'Циркуни',
      address: 'Відділення №1',
      branchNumber: '1',
    },
    relatedShipments: [
      {
        ttn: '59001764954977',
        relation: 'return',
        relatedTtn: '20451528497280',
        destination: { city: 'Циркуни', address: 'Відділення №1', branchNumber: '1' },
      },
    ],
    details: { trackingExpectedDeliveryAt: '08-09-2026 15:00:00' },
  }
  const next = mergeTrackingDelivery(delivery, liveReturn, '2026-09-07T16:12:37Z')
  assert(next.ttn === '59001764954977', 'return TTN did not become current')
  assert(next.trackingReturnInProgress === true, 'return relation did not restore return stage')
  assert(next.trackingStatus === liveReturn.status, 'live return status was not stored')
  assert(next.city === 'Циркуни', 'live return city was not stored')
  assert(next.address === 'Відділення №1', 'live return branch was not stored')
  assert(next.trackingDestinationBranchNumber === '1', 'live return branch number was not stored')
  assert(next.trackingExpectedDeliveryAt === '08-09-2026 15:00:00', 'live return ETA was not stored')
  assert(Array.isArray(next.ttnHistory) && next.ttnHistory.includes('20451528497280'), 'original TTN was not preserved')
  assert(
    Array.isArray(next.shipmentHistory) && next.shipmentHistory.some((row) =>
      record(row).ttn === '59001764954977' && record(row).relation === 'return'
    ),
    'return TTN was not preserved in shipment history',
  )
})
