import { mergeTrackingDelivery, trackingChanged } from './storage.ts'
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
