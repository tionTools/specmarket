import { hasPhysicalShipmentMovement } from '../../../src/lib/physical-shipment.ts'

type RecordValue = Record<string, unknown>

const text = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : ''

const number = (value: unknown) => Number(text(value).replace(',', '.').replace(/[^\d.-]/g, '')) || 0

export function kastaHasReturnSignal(statuses: unknown[]) {
  return statuses.some((status) => {
    if (!status || typeof status !== 'object') return false
    return /^(?:Cancelled|Return|Refund)/i.test(text((status as RecordValue).type))
  })
}

export function kastaPhysicalMovement(delivery: RecordValue) {
  return hasPhysicalShipmentMovement(delivery)
}

export function preserveKastaPhysicalReturnQuantity(
  statuses: unknown[],
  delivery: RecordValue,
  apiQuantity: number,
  previousQuantity: number,
) {
  return kastaHasReturnSignal(statuses) &&
      kastaPhysicalMovement(delivery) &&
      previousQuantity > 0
    ? previousQuantity
    : apiQuantity
}

export function resolveKastaPersistedItemSnapshot<T extends RecordValue>(
  statuses: unknown[],
  delivery: RecordValue,
  previous: T | undefined,
  api: T,
): T {
  if (
    !previous ||
    number(previous.quantity) <= 0 ||
    !kastaHasReturnSignal(statuses) ||
    !kastaPhysicalMovement(delivery)
  ) {
    return api
  }

  const resolved: RecordValue = { ...api }
  for (const key of [
    'quantity',
    'price',
    'cost',
    'cost_usd',
    'royalty_percent',
    'royalty_amount',
  ]) {
    if (Object.prototype.hasOwnProperty.call(previous, key)) resolved[key] = previous[key]
  }
  return resolved as T
}

export function quantityAfterAcceptedReturn(quantity: number, acceptedReturnQuantity: number) {
  return Math.max(0, quantity - acceptedReturnQuantity)
}
