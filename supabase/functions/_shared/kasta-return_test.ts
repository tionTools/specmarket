import {
  kastaPhysicalMovement,
  preserveKastaPhysicalReturnQuantity,
  quantityAfterAcceptedReturn,
  resolveKastaPersistedItemSnapshot,
} from './kasta-return.ts'

function assert(value: unknown, message = 'Assertion failed'): asserts value {
  if (!value) throw new Error(message)
}

Deno.test('physical shipment uses only print or normalized carrier movement', () => {
  assert(!kastaPhysicalMovement({ ttn: '2040' }), 'bare TTN must not prove movement')
  assert(!kastaPhysicalMovement({ trackingEventAt: '2026-09-01' }), 'event time must not prove movement')
  assert(!kastaPhysicalMovement({ trackingStatusCode: '7' }), 'raw code must not prove movement')
  assert(kastaPhysicalMovement({ printedAt: '2026-09-01' }))
  for (const status of [
    'accepted',
    'in_transit',
    'ready_for_pickup',
    'delivered',
    'returning',
    'returned',
  ]) {
    assert(kastaPhysicalMovement({ trackingNormalizedStatus: status }), status)
  }
})

Deno.test('production snapshot resolver keeps S5TSAE5 financials until CRM accepts return', () => {
  const statuses = [{ type: 'Cancelled' }]
  const previous = {
    quantity: 1,
    price: 676,
    cost: 429,
    cost_usd: 10.5,
    royalty_percent: 15,
    royalty_amount: 101.4,
    product_name: 'old name',
  }
  const api = {
    quantity: 0,
    price: 0,
    cost: 0,
    cost_usd: 0,
    royalty_percent: 0,
    royalty_amount: 0,
    product_name: 'current API name',
  }
  const resolved = resolveKastaPersistedItemSnapshot(
    statuses,
    { trackingNormalizedStatus: 'returning' },
    previous,
    api,
  )
  assert(resolved.quantity === 1)
  assert(resolved.price === 676)
  assert(resolved.cost === 429)
  assert(resolved.cost_usd === 10.5)
  assert(resolved.royalty_percent === 15)
  assert(resolved.royalty_amount === 101.4)
  assert(resolved.product_name === 'current API name', 'non-financial API fields must still refresh')
})

Deno.test('cancellation before physical movement keeps API zero snapshot', () => {
  const statuses = [{ type: 'Cancelled' }]
  const previous = { quantity: 1, price: 676, cost: 429 }
  const api = { quantity: 0, price: 0, cost: 0 }
  const resolved = resolveKastaPersistedItemSnapshot(statuses, { ttn: '2040' }, previous, api)
  assert(resolved.quantity === 0)
  assert(resolved.price === 0)
  assert(resolved.cost === 0)
  assert(preserveKastaPhysicalReturnQuantity(statuses, { ttn: '2040' }, 0, 1) === 0)
})

Deno.test('accepted CRM return quantity reduces the preserved original quantity', () => {
  assert(quantityAfterAcceptedReturn(1, 0) === 1)
  assert(quantityAfterAcceptedReturn(1, 1) === 0)
  assert(quantityAfterAcceptedReturn(2, 1) === 1)
})
