import { carrierKind } from './carrier-detection.ts'
import { text } from './normalize.ts'
import type { JsonRecord, TrackingResult } from './types.ts'

function shipmentValue(value: unknown) {
  return text(value).replace(/\s/g, '').toLowerCase()
}

export function sameShipment(left: JsonRecord, right: JsonRecord) {
  return shipmentValue(left.ttn) === shipmentValue(right.ttn) && carrierKind(left) === carrierKind(right)
}

export function trackingChanged(delivery: JsonRecord, result: TrackingResult) {
  return result.status !== text(delivery.trackingStatus) || result.normalizedStatus !== text(delivery.trackingNormalizedStatus)
}

export function mergeTrackingDelivery(currentDelivery: JsonRecord, result: TrackingResult, changedAt: string) {
  const nextDelivery: JsonRecord = {
    ...currentDelivery,
    trackingStatus: result.status,
  }
  nextDelivery.trackingStatusChangedAt = changedAt
  if (result.provider && result.details) {
    Object.assign(nextDelivery, {
      ...result.details,
      trackingProvider: result.provider,
      trackingSource: 'official_api',
      trackingNormalizedStatus: result.normalizedStatus,
    })
  }
  return nextDelivery
}
