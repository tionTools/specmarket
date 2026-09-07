import { getNetOrderAmount } from '../../../src/features/orders/financials.ts'
import {
  getOrderLifecycleState,
  hasPhysicalShipmentMovement,
  includeInUnpaidShipment,
  includeInTurnoverReport,
  isOrderVisibleInMainList,
  isReturnLifecycleState,
} from '../../../src/features/orders/shipment-accounting.ts'
import type { Order } from '../../../src/features/orders/types.ts'

function assert(value: unknown, message = 'Assertion failed'): asserts value {
  if (!value) throw new Error(message)
}

const order = (delivery: Partial<Order['delivery']>, quantity = 1): Order => ({
  id: 'S5TSAE5',
  date: '01.09.2026',
  customer: '',
  phone: '',
  platform: 'Каста',
  status: 'Скасовано / Відмова від отримання',
  products: [{ id: '1', name: '', size: '', quantity, price: 676 / quantity, cost: 429 / quantity }],
  shipping: 0,
  acquiring: 0,
  delivery: {
    carrier: 'Новая почта',
    ttn: '2040',
    recipient: '',
    recipientPhone: '',
    city: '',
    address: '',
    status: '',
    payer: '',
    ...delivery,
  },
})

Deno.test('bare TTN does not turn pre-shipment cancellation into in-transit money', () => {
  const cancelled = order({})
  assert(!hasPhysicalShipmentMovement(cancelled))
  assert(!includeInUnpaidShipment(cancelled, cancelled.status, false))
  assert(!includeInTurnoverReport(cancelled, cancelled.status))
  const state = getOrderLifecycleState(cancelled, cancelled.status)
  assert(state === 'cancelled_before_shipment')
  assert(!isOrderVisibleInMainList(state))
  assert(!isReturnLifecycleState(state))
})

Deno.test('S5TSAE5 stays in turnover until return acceptance and then contributes zero', () => {
  const shipped = order({ printedAt: '2026-09-05', trackingNormalizedStatus: 'cancelled' })
  assert(hasPhysicalShipmentMovement(shipped))
  assert(includeInUnpaidShipment(shipped, shipped.status, false))
  assert(includeInTurnoverReport(shipped, shipped.status))
  assert(getNetOrderAmount(shipped) === 676)
  const pendingState = getOrderLifecycleState(shipped, shipped.status)
  assert(pendingState === 'return_pending')
  assert(isOrderVisibleInMainList(pendingState))
  assert(isReturnLifecycleState(pendingState))

  shipped.products[0]!.returnedQuantity = 1
  assert(getNetOrderAmount(shipped) === 0)
  assert(includeInTurnoverReport(shipped, shipped.status))
  assert(!includeInUnpaidShipment(shipped, shipped.status, false))
  const completedState = getOrderLifecycleState(shipped, shipped.status)
  assert(completedState === 'return_completed')
  assert(!isOrderVisibleInMainList(completedState))
  assert(isReturnLifecycleState(completedState))
})

Deno.test('partial accepted return remains in transit only for the remaining quantity', () => {
  const partial = order({ printedAt: '2026-09-01' }, 2)
  partial.products[0]!.returnedQuantity = 1
  assert(getNetOrderAmount(partial) === 338)
  assert(includeInTurnoverReport(partial, partial.status))
  assert(includeInUnpaidShipment(partial, partial.status, false))
  const state = getOrderLifecycleState(partial, partial.status)
  assert(state === 'return_partial')
  assert(isOrderVisibleInMainList(state))
  assert(isReturnLifecycleState(state))
})

Deno.test('paid shipment is never included in unpaid shipment amount', () => {
  const paid = order({ trackingNormalizedStatus: 'returning' })
  assert(!includeInUnpaidShipment(paid, paid.status, true))
})
