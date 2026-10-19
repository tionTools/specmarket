import { hasConfirmedCarrierMovement } from '../../../src/lib/physical-shipment.ts'

export function epicentrCancellationTtn(
  statusCode: string,
  apiTtn: string,
  previousDelivery: Record<string, unknown>,
) {
  const previousTtn = typeof previousDelivery.ttn === 'string' ? previousDelivery.ttn.trim() : ''
  const trackingStatus =
    typeof previousDelivery.trackingNormalizedStatus === 'string'
      ? previousDelivery.trackingNormalizedStatus.trim().toLowerCase()
      : ''
  const retired =
    /^(?:canceled|cancelled)(?:_by_seller)?$/i.test(statusCode) &&
    !apiTtn &&
    Boolean(previousTtn) &&
    ['created', 'deleted'].includes(trackingStatus) &&
    !hasConfirmedCarrierMovement(previousDelivery)
  if (!retired) return { ttn: apiTtn || previousTtn, retired: false }

  const history = Array.isArray(previousDelivery.ttnHistory)
    ? previousDelivery.ttnHistory.filter((value): value is string => typeof value === 'string')
    : []
  if (!history.includes(previousTtn)) history.push(previousTtn)
  return { ttn: '', retired: true, ttnHistory: history }
}
