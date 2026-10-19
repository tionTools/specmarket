import { getNetOrderAmount } from '../../../src/features/orders/financials.ts'
import {
  getOrderLifecycleState,
  hasActualFinancialResult,
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

Deno.test('Epicentr printed label without carrier handover is a pre-shipment cancellation', () => {
  const cancelled = order({ printedAt: '2026-10-19', trackingNormalizedStatus: 'created' })
  cancelled.platform = 'Эпицентр'
  cancelled.products[0]!.price = 695
  cancelled.products[0]!.cost = 432
  cancelled.products[0]!.returnedQuantity = 1
  cancelled.shipping = 38.48
  assert(!hasPhysicalShipmentMovement(cancelled))
  assert(getOrderLifecycleState(cancelled, cancelled.status) === 'cancelled_before_shipment')
  assert(!includeInTurnoverReport(cancelled, cancelled.status))
  assert(!includeInUnpaidShipment(cancelled, cancelled.status, false))
  assert(!isReturnLifecycleState(getOrderLifecycleState(cancelled, cancelled.status)))
  assert(
    !hasActualFinancialResult(cancelled, cancelled.status),
    'phantom return must not create -38.48 actual profit',
  )
  cancelled.products[0]!.returnedQuantity = 0
  assert(getNetOrderAmount(cancelled) === 695, 'original item must remain intact')
  assert(!includeInTurnoverReport(cancelled, cancelled.status), 'removing false return must not restore sale')
  assert(!includeInUnpaidShipment(cancelled, cancelled.status, false))
  assert(!hasActualFinancialResult(cancelled, cancelled.status))
})

Deno.test('Epicentr confirmed handover and genuine return keep the return lifecycle', () => {
  const shipped = order({ printedAt: '2026-10-19', trackingNormalizedStatus: 'accepted' })
  shipped.platform = 'Эпицентр'
  assert(hasPhysicalShipmentMovement(shipped))
  assert(getOrderLifecycleState(shipped, shipped.status) === 'return_pending')
  assert(includeInTurnoverReport(shipped, shipped.status))
  shipped.products[0]!.returnedQuantity = 1
  assert(getOrderLifecycleState(shipped, shipped.status) === 'return_completed')
  assert(
    hasActualFinancialResult(shipped, shipped.status),
    'genuine accepted return remains realized',
  )
  assert(!includeInUnpaidShipment(shipped, shipped.status, false))
})

Deno.test('Epicentr unknown carrier status does not turn printing into handover', () => {
  const unknown = order({ printedAt: '2026-10-19', trackingNormalizedStatus: 'unknown' })
  unknown.platform = 'Эпицентр'
  assert(!hasPhysicalShipmentMovement(unknown))
  assert(getOrderLifecycleState(unknown, unknown.status) === 'cancelled_before_shipment')
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


Deno.test('deleted carrier TTN does not become shipment movement even after label printing', () => {
  const deleted = order({
    printedAt: '2026-09-28',
    trackingNormalizedStatus: 'deleted',
  })
  assert(!hasPhysicalShipmentMovement(deleted))
  assert(!includeInUnpaidShipment(deleted, deleted.status, false))
  assert(!includeInTurnoverReport(deleted, deleted.status))
  assert(getOrderLifecycleState(deleted, deleted.status) === 'cancelled_before_shipment')
})

Deno.test('deleted carrier TTN does not cancel an otherwise active marketplace order', () => {
  const active = order({ trackingNormalizedStatus: 'deleted' })
  active.status = 'Принято'
  assert(getOrderLifecycleState(active, active.status) === 'active')
  assert(!includeInUnpaidShipment(active, active.status, false))
  assert(!includeInTurnoverReport(active, active.status))
})
