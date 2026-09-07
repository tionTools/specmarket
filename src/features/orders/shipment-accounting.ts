import type { Order } from './types'
import { getRemainingQuantity } from './financials'
import { hasPhysicalShipmentMovement as deliveryHasPhysicalMovement } from '../../lib/physical-shipment'

export type OrderLifecycleState =
  | 'active'
  | 'cancelled_before_shipment'
  | 'return_pending'
  | 'return_partial'
  | 'return_completed'

const returnStatus = (status: string) =>
  /скас|отмен|cancel|повер|возврат|return|refund|відмов.*отрим/.test(status.toLowerCase())

export function hasPhysicalShipmentMovement(order: Order) {
  return deliveryHasPhysicalMovement(order.delivery)
}

export function hasReturnSignal(order: Order, status: string) {
  const normalizedTracking = order.delivery.trackingNormalizedStatus?.trim().toLowerCase()
  return (
    returnStatus(status) || normalizedTracking === 'returning' || normalizedTracking === 'returned'
  )
}

export function getOrderLifecycleState(order: Order, status: string): OrderLifecycleState {
  const hasSignal = hasReturnSignal(order, status)
  if (!hasSignal) return 'active'

  if (!hasPhysicalShipmentMovement(order)) return 'cancelled_before_shipment'

  const acceptedReturnQuantity = order.products.reduce(
    (sum, product) => sum + Math.max(0, product.returnedQuantity ?? 0),
    0,
  )
  const remainingQuantity = order.products.reduce(
    (sum, product) => sum + getRemainingQuantity(product),
    0,
  )

  if (acceptedReturnQuantity <= 0) return 'return_pending'
  if (remainingQuantity <= 0) return 'return_completed'
  return 'return_partial'
}

export function isOrderVisibleInMainList(state: OrderLifecycleState) {
  return state === 'active' || state === 'return_pending' || state === 'return_partial'
}

export function isReturnLifecycleState(state: OrderLifecycleState) {
  return state === 'return_pending' || state === 'return_partial' || state === 'return_completed'
}

export function includeInTurnoverReport(order: Order, status: string) {
  if (!order.delivery.ttn.trim()) return false
  return getOrderLifecycleState(order, status) !== 'cancelled_before_shipment'
}

export function includeInUnpaidShipment(order: Order, status: string, paid: boolean) {
  if (!order.delivery.ttn.trim() || paid) return false
  const state = getOrderLifecycleState(order, status)
  if (state === 'cancelled_before_shipment' || state === 'return_completed') return false
  return order.products.some((product) => getRemainingQuantity(product) > 0)
}
