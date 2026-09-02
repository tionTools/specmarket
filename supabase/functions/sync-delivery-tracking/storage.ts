import { carrierKind } from './carrier-detection.ts'
import { record, text } from './normalize.ts'
import type {
  JsonRecord,
  RelatedShipment,
  ShipmentRelation,
  ShipmentSource,
  TrackingDestination,
  TrackingResult,
} from './types.ts'

function shipmentValue(value: unknown) {
  return text(value).replace(/\s/g, '').toLowerCase()
}

function normalizedText(value: unknown) {
  return text(value).replace(/\s+/g, ' ').toLowerCase()
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as JsonRecord)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]),
  )
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right))
}

function pushUnique(values: string[], value: string) {
  const normalized = normalizedText(value)
  if (!normalized || values.some((item) => normalizedText(item) === normalized)) return values
  return [...values, value]
}

function currentAddress(delivery: JsonRecord) {
  return [text(delivery.city), text(delivery.address)].filter(Boolean).join(', ')
}

function destinationChanged(delivery: JsonRecord, destination?: TrackingDestination) {
  if (!destination) return false
  if (destination.city && normalizedText(destination.city) !== normalizedText(delivery.city)) return true
  if (destination.address && normalizedText(destination.address) !== normalizedText(delivery.address)) return true
  if (
    destination.branchNumber &&
    normalizedText(destination.branchNumber) !== normalizedText(delivery.trackingDestinationBranchNumber)
  ) return true
  if (
    destination.locationCode &&
    normalizedText(destination.locationCode) !== normalizedText(delivery.trackingDestinationLocationCode)
  ) return true
  if (
    destination.postalCode &&
    normalizedText(destination.postalCode) !== normalizedText(delivery.trackingDestinationPostalCode)
  ) return true
  return false
}

function destinationHistoryChanged(delivery: JsonRecord, destination?: TrackingDestination) {
  if (!destination) return false
  if (destination.city && normalizedText(destination.city) !== normalizedText(delivery.city)) return true
  if (destination.address && normalizedText(destination.address) !== normalizedText(delivery.address)) return true
  for (const [nextKey, currentKey] of [
    ['branchNumber', 'trackingDestinationBranchNumber'],
    ['locationCode', 'trackingDestinationLocationCode'],
    ['postalCode', 'trackingDestinationPostalCode'],
  ] as const) {
    const current = normalizedText(delivery[currentKey])
    const next = normalizedText(destination[nextKey])
    if (current && next && current !== next) return true
  }
  return false
}

function relatedShipmentsValue(shipments: RelatedShipment[] | undefined) {
  return (shipments ?? []).map((shipment) => ({
    ttn: shipmentValue(shipment.ttn),
    relation: shipment.relation,
    relatedTtn: shipmentValue(shipment.relatedTtn),
    destination: shipment.destination ?? null,
  }))
}

function historyRelationPriority(value: unknown) {
  switch (text(value)) {
    case 'original':
      return 5
    case 'redirect':
    case 'return':
      return 4
    case 'replacement':
      return 3
    default:
      return 1
  }
}

function mergeHistoryRows(current: JsonRecord, incoming: JsonRecord) {
  const incomingIsPreferred =
    historyRelationPriority(incoming.relation) > historyRelationPriority(current.relation)
  const preferred = incomingIsPreferred ? incoming : current
  const fallback = incomingIsPreferred ? current : incoming
  return {
    ...fallback,
    ...preferred,
    firstSeenAt: text(current.firstSeenAt) || text(incoming.firstSeenAt),
    lastSeenAt: text(incoming.lastSeenAt) || text(current.lastSeenAt),
  }
}

function normalizeHistoryRows(value: unknown) {
  const rows = Array.isArray(value) ? value.map(record).filter((entry) => text(entry.ttn)) : []
  const normalized: JsonRecord[] = []
  const indexByTtn = new Map<string, number>()
  for (const entry of rows) {
    const ttn = shipmentValue(entry.ttn)
    if (!ttn) continue
    const existingIndex = indexByTtn.get(ttn)
    if (existingIndex === undefined) {
      indexByTtn.set(ttn, normalized.length)
      normalized.push(entry)
      continue
    }
    normalized[existingIndex] = mergeHistoryRows(normalized[existingIndex]!, entry)
  }
  return normalized
}

function hasDuplicateHistoryTtn(value: unknown) {
  if (!Array.isArray(value)) return false
  const seen = new Set<string>()
  for (const rawEntry of value) {
    const ttn = shipmentValue(record(rawEntry).ttn)
    if (!ttn) continue
    if (seen.has(ttn)) return true
    seen.add(ttn)
  }
  return false
}

function historyRows(value: unknown) {
  return normalizeHistoryRows(value)
}

function appendHistoryEntry(history: JsonRecord[], entry: JsonRecord, seenAt: string) {
  if (!text(entry.ttn)) return history
  const normalized: JsonRecord = {
    ttn: text(entry.ttn),
    carrier: text(entry.carrier),
    relation: text(entry.relation) || 'unknown',
    source: text(entry.source) || 'carrier_api',
    firstSeenAt: text(entry.firstSeenAt) || seenAt,
    lastSeenAt: seenAt,
  }
  for (const key of ['relatedTtn', 'city', 'address', 'branchNumber', 'locationCode', 'postalCode']) {
    const value = text(entry[key])
    if (value) normalized[key] = value
  }
  return normalizeHistoryRows([...history, normalized])
}

function snapshotEntry(
  delivery: JsonRecord,
  relation: ShipmentRelation,
  source: ShipmentSource,
  seenAt: string,
  relatedTtn = '',
): JsonRecord {
  return {
    ttn: text(delivery.ttn),
    carrier: text(delivery.carrier),
    relation,
    relatedTtn,
    city: text(delivery.city),
    address: text(delivery.address),
    branchNumber: text(delivery.trackingDestinationBranchNumber),
    locationCode: text(delivery.trackingDestinationLocationCode),
    postalCode: text(delivery.trackingDestinationPostalCode),
    source,
    firstSeenAt: seenAt,
    lastSeenAt: seenAt,
  }
}

function relatedEntry(
  delivery: JsonRecord,
  shipment: RelatedShipment,
  source: ShipmentSource,
  seenAt: string,
): JsonRecord {
  return {
    ttn: shipment.ttn,
    carrier: text(delivery.carrier),
    relation: shipment.relation,
    relatedTtn: shipment.relatedTtn,
    city: shipment.destination?.city,
    address: shipment.destination?.address,
    branchNumber: shipment.destination?.branchNumber,
    locationCode: shipment.destination?.locationCode,
    postalCode: shipment.destination?.postalCode,
    source,
    firstSeenAt: seenAt,
    lastSeenAt: seenAt,
  }
}

export function sameShipment(left: JsonRecord, right: JsonRecord) {
  return shipmentValue(left.ttn) === shipmentValue(right.ttn) && carrierKind(left) === carrierKind(right)
}

export function trackingChanged(delivery: JsonRecord, result: TrackingResult) {
  if (hasDuplicateHistoryTtn(delivery.shipmentHistory)) return true
  if (text(delivery.ttn) && !historyRows(delivery.shipmentHistory).length) return true
  if (result.status !== text(delivery.trackingStatus)) return true
  if (result.normalizedStatus !== text(delivery.trackingNormalizedStatus)) return true
  if (result.activeTtn && shipmentValue(result.activeTtn) !== shipmentValue(delivery.ttn)) return true
  if (destinationChanged(delivery, result.destination)) return true
  if (
    result.relatedShipments &&
    !sameValue(relatedShipmentsValue(result.relatedShipments), delivery.trackingRelatedShipments ?? [])
  ) return true
  if (result.events && !sameValue(result.events, delivery.trackingEvents ?? [])) return true
  for (const [key, value] of Object.entries(result.details ?? {})) {
    if (value !== undefined && !sameValue(value, delivery[key])) return true
  }
  return false
}

export function mergeTrackingDelivery(
  currentDelivery: JsonRecord,
  result: TrackingResult,
  changedAt: string,
  baselineSource: Extract<ShipmentSource, 'marketplace' | 'manual'> = 'marketplace',
) {
  const nextDelivery: JsonRecord = { ...currentDelivery }
  const oldTtn = text(currentDelivery.ttn)
  const oldAddress = currentAddress(currentDelivery)
  const activeTtn = text(result.activeTtn) || oldTtn
  const source = result.source ?? 'carrier_api'
  const ttnChanged = Boolean(activeTtn) && shipmentValue(activeTtn) !== shipmentValue(oldTtn)
  const addressChanged = destinationHistoryChanged(currentDelivery, result.destination)
  const statusChanged =
    result.status !== text(currentDelivery.trackingStatus) ||
    result.normalizedStatus !== text(currentDelivery.trackingNormalizedStatus)

  let history = historyRows(currentDelivery.shipmentHistory)
  if (oldTtn && !history.length) {
    history = appendHistoryEntry(
      history,
      snapshotEntry(currentDelivery, 'original', baselineSource, changedAt),
      changedAt,
    )
  } else if (oldTtn && (ttnChanged || addressChanged)) {
    const existingCurrent = [...history].reverse().find((entry) => shipmentValue(entry.ttn) === shipmentValue(oldTtn))
    history = appendHistoryEntry(
      history,
      snapshotEntry(
        currentDelivery,
        (text(existingCurrent?.relation) as ShipmentRelation) || 'original',
        (text(existingCurrent?.source) as ShipmentSource) || baselineSource,
        changedAt,
        text(existingCurrent?.relatedTtn),
      ),
      changedAt,
    )
  }

  for (const shipment of result.relatedShipments ?? []) {
    history = appendHistoryEntry(history, relatedEntry(currentDelivery, shipment, source, changedAt), changedAt)
  }

  if (ttnChanged && oldTtn) {
    nextDelivery.ttnHistory = pushUnique(
      Array.isArray(currentDelivery.ttnHistory) ? currentDelivery.ttnHistory.map(text).filter(Boolean) : [],
      oldTtn,
    )
  }
  if ((ttnChanged || addressChanged) && oldAddress) {
    nextDelivery.addressHistory = pushUnique(
      Array.isArray(currentDelivery.addressHistory) ? currentDelivery.addressHistory.map(text).filter(Boolean) : [],
      oldAddress,
    )
  }

  if (activeTtn) nextDelivery.ttn = activeTtn
  if (result.destination?.city) {
    nextDelivery.city = result.destination.city
    nextDelivery.trackingDestinationCity = result.destination.city
  }
  if (result.destination?.address) {
    nextDelivery.address = result.destination.address
    nextDelivery.trackingDestinationAddress = result.destination.address
  }
  if (result.destination?.branchNumber)
    nextDelivery.trackingDestinationBranchNumber = result.destination.branchNumber
  if (result.destination?.locationCode)
    nextDelivery.trackingDestinationLocationCode = result.destination.locationCode
  if (result.destination?.postalCode)
    nextDelivery.trackingDestinationPostalCode = result.destination.postalCode

  if (activeTtn && (ttnChanged || addressChanged || result.relation)) {
    const currentRelated = (result.relatedShipments ?? []).find(
      (shipment) => shipmentValue(shipment.ttn) === shipmentValue(activeTtn),
    )
    const relation = result.relation ?? currentRelated?.relation ?? 'unknown'
    const currentSnapshot: JsonRecord = {
      ttn: activeTtn,
      carrier: text(currentDelivery.carrier),
      relation,
      relatedTtn: currentRelated?.relatedTtn || (ttnChanged ? oldTtn : ''),
      city: text(result.destination?.city) || text(nextDelivery.city),
      address: text(result.destination?.address) || text(nextDelivery.address),
      branchNumber: text(result.destination?.branchNumber) || text(nextDelivery.trackingDestinationBranchNumber),
      locationCode: text(result.destination?.locationCode) || text(nextDelivery.trackingDestinationLocationCode),
      postalCode: text(result.destination?.postalCode) || text(nextDelivery.trackingDestinationPostalCode),
      source,
      firstSeenAt: changedAt,
      lastSeenAt: changedAt,
    }
    history = appendHistoryEntry(history, currentSnapshot, changedAt)
  }
  if (history.length) nextDelivery.shipmentHistory = history

  nextDelivery.trackingStatus = result.status
  nextDelivery.trackingNormalizedStatus = result.normalizedStatus
  nextDelivery.trackingProvider = result.provider ?? carrierKind(currentDelivery)
  nextDelivery.trackingSource = source === 'public_tracking' ? 'public_tracking' : 'official_api'
  nextDelivery.trackingDataChangedAt = changedAt
  if (statusChanged) nextDelivery.trackingStatusChangedAt = changedAt
  if (result.relatedShipments)
    nextDelivery.trackingRelatedShipments = relatedShipmentsValue(result.relatedShipments)
  if (result.events) nextDelivery.trackingEvents = result.events
  if (result.details) Object.assign(nextDelivery, result.details)
  return nextDelivery
}
