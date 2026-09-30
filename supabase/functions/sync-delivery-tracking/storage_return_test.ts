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
  assert(next.trackingReturnArrived === true, 'terminal return was not marked as arrived')
  assert(next.city === 'Циркуни', 'terminal return changed the return destination back to recipient')
})

Deno.test('ordinary buyer delivery does not become a returned-to-sender arrival', () => {
  const delivery: JsonRecord = {
    ttn: '20451528497280',
    carrier: 'Новая почта',
    city: 'Київ',
    address: 'Відділення №343',
    trackingStatus: 'У відділенні',
    trackingNormalizedStatus: 'ready_for_pickup',
    shipmentHistory: [
      {
        ttn: '20451528497280',
        carrier: 'Новая почта',
        relation: 'original',
        city: 'Київ',
        address: 'Відділення №343',
        source: 'marketplace',
        firstSeenAt: '2026-09-05T15:03:54Z',
        lastSeenAt: '2026-09-08T11:00:00Z',
      },
    ],
  }
  const delivered: TrackingResult = {
    status: 'Відправлення отримано',
    final: true,
    normalizedStatus: 'delivered',
    destination: { city: 'Київ', address: 'Відділення №343' },
  }
  const next = mergeTrackingDelivery(delivery, delivered, '2026-09-08T12:00:00Z')
  assert(next.trackingReturnInProgress === false, 'ordinary delivery became a return in progress')
  assert(next.trackingReturnArrived === false, 'ordinary buyer delivery became a return arrival')
  assert(next.trackingBuyerReceived === true, 'ordinary buyer delivery was not remembered')
})

Deno.test('delivered return TTN repairs return-arrived state after the old flag was lost', () => {
  const delivery: JsonRecord = {
    ttn: '59001787388688',
    carrier: 'Новая почта',
    city: 'Циркуни',
    address: 'Відділення №1',
    trackingStatus: 'Відправлення отримано',
    trackingNormalizedStatus: 'delivered',
    trackingReturnInProgress: false,
    shipmentHistory: [
      {
        ttn: '20451544077350',
        carrier: 'Новая почта',
        relation: 'original',
        city: 'Ірпінь',
        address: 'Відділення №11',
        source: 'marketplace',
        firstSeenAt: '2026-09-24T09:07:00Z',
        lastSeenAt: '2026-09-27T10:00:00Z',
      },
      {
        ttn: '59001787388688',
        carrier: 'Новая почта',
        relation: 'return',
        relatedTtn: '20451544077350',
        city: 'Циркуни',
        address: 'Відділення №1',
        source: 'carrier_api',
        firstSeenAt: '2026-09-27T10:00:00Z',
        lastSeenAt: '2026-09-29T08:29:00Z',
      },
    ],
  }
  const delivered: TrackingResult = {
    status: 'Відправлення отримано',
    final: true,
    normalizedStatus: 'delivered',
    destination: { city: 'Ірпінь', address: 'Відділення №11' },
  }

  assert(trackingChanged(delivery, delivered), 'lost return-arrived state was not detected')
  const next = mergeTrackingDelivery(delivery, delivered, '2026-09-29T08:30:00Z')
  assert(next.trackingReturnInProgress === false, 'arrived return was put back in progress')
  assert(next.trackingReturnArrived === true, 'return history did not restore return-arrived state')
  assert(next.city === 'Циркуни', 'recovery changed return destination back to the buyer')
  assert(next.address === 'Відділення №1', 'recovery changed return branch back to the buyer')
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
  assert(next.trackingBuyerReceived === false, 'unclaimed return was incorrectly marked as buyer receipt')
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


Deno.test('buyer receipt remains remembered when a later return shipment appears', () => {
  const delivery: JsonRecord = {
    ttn: '20451528497280',
    carrier: 'Новая почта',
    city: 'Київ',
    address: 'Відділення №343',
    trackingStatus: 'Відправлення отримано',
    trackingNormalizedStatus: 'delivered',
    trackingBuyerReceived: true,
  }
  const liveReturn: TrackingResult = {
    status: 'Відправлення повертається відправнику',
    final: false,
    normalizedStatus: 'in_transit',
    activeTtn: '59001764954977',
    relation: 'return',
    destination: { city: 'Циркуни', address: 'Відділення №1' },
  }

  const next = mergeTrackingDelivery(delivery, liveReturn, '2026-09-09T12:00:00Z')
  assert(next.trackingReturnInProgress === true, 'later return was not recognized')
  assert(next.trackingBuyerReceived === true, 'later return erased the earlier buyer receipt')
})
