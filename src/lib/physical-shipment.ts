export type PhysicalShipmentDelivery = {
  printedAt?: unknown
  trackingNormalizedStatus?: unknown
}

const physicalCarrierStatuses = new Set([
  'accepted',
  'in_transit',
  'ready_for_pickup',
  'delivered',
  'returning',
  'returned',
])

const text = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''

export function hasPhysicalShipmentMovement(delivery: PhysicalShipmentDelivery) {
  const normalizedStatus = text(delivery.trackingNormalizedStatus).toLowerCase()
  if (normalizedStatus === 'deleted') return false
  if (text(delivery.printedAt)) return true
  return physicalCarrierStatuses.has(normalizedStatus)
}
