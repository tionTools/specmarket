type Delivery = Record<string, unknown>

function text(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

function shipmentValue(value: unknown) {
  return text(value).replace(/\s/g, '').toLowerCase()
}

function carrierKind(value: unknown) {
  const carrier = shipmentValue(value)
  if (carrier.includes('nova') || carrier.includes('нова')) return 'nova'
  if (carrier.includes('meest') || carrier.includes('міст')) return 'meest'
  if (carrier.includes('rozetka')) return 'rozetka'
  if (carrier.includes('ukr') || carrier.includes('укр')) return 'ukrposhta'
  return carrier
}

export function marketplaceMatchesCarrierDelivery(delivery: Delivery, carrier: string, marketplaceTtn: string) {
  if (carrierKind(delivery.carrier) !== carrierKind(carrier)) return false
  const activeTtn = shipmentValue(delivery.ttn)
  const incomingTtn = shipmentValue(marketplaceTtn)
  if (!activeTtn || !incomingTtn) return activeTtn === incomingTtn
  if (activeTtn === incomingTtn) return true

  const links = new Map<string, Set<string>>()
  for (const value of Array.isArray(delivery.shipmentHistory) ? delivery.shipmentHistory : []) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const entry = value as Delivery
    const ttn = shipmentValue(entry.ttn)
    const relatedTtn = shipmentValue(entry.relatedTtn)
    if (!ttn) continue
    if (!links.has(ttn)) links.set(ttn, new Set())
    if (!relatedTtn) continue
    if (!links.has(relatedTtn)) links.set(relatedTtn, new Set())
    links.get(ttn)?.add(relatedTtn)
    links.get(relatedTtn)?.add(ttn)
  }

  const visited = new Set<string>([incomingTtn])
  const pending = [incomingTtn]
  while (pending.length) {
    const current = pending.pop() ?? ''
    for (const next of links.get(current) ?? []) {
      if (visited.has(next)) continue
      if (next === activeTtn) return true
      visited.add(next)
      pending.push(next)
    }
  }
  return false
}

export function marketplaceMustKeepCarrierDelivery(delivery: Delivery, carrier: string, marketplaceTtn: string) {
  return shipmentValue(delivery.ttn) !== shipmentValue(marketplaceTtn) &&
    marketplaceMatchesCarrierDelivery(delivery, carrier, marketplaceTtn)
}

export function marketplaceReplacementHistory(
  delivery: Delivery,
  carrier: string,
  marketplaceTtn: string,
  destination: { city?: string; address?: string } = {},
): Delivery {
  const activeTtn = shipmentValue(delivery.ttn)
  const incomingTtn = shipmentValue(marketplaceTtn)
  if (
    carrierKind(delivery.carrier) !== carrierKind(carrier) ||
    !activeTtn ||
    !incomingTtn ||
    activeTtn === incomingTtn ||
    marketplaceMatchesCarrierDelivery(delivery, carrier, marketplaceTtn)
  ) return {}

  const seenAt = new Date().toISOString()
  const shipmentHistory = Array.isArray(delivery.shipmentHistory) ? [...delivery.shipmentHistory] : []
  if (!shipmentHistory.some((value) => value && typeof value === 'object' && !Array.isArray(value) && shipmentValue((value as Delivery).ttn) === activeTtn)) {
    shipmentHistory.push({
      ttn: delivery.ttn,
      carrier: delivery.carrier,
      relation: 'original',
      city: text(delivery.city),
      address: text(delivery.address),
      source: 'marketplace',
      firstSeenAt: seenAt,
      lastSeenAt: seenAt,
    })
  }
  const hasReplacement = shipmentHistory.some((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const entry = value as Delivery
    return shipmentValue(entry.ttn) === incomingTtn && shipmentValue(entry.relatedTtn) === activeTtn && entry.relation === 'unknown'
  })
  if (!hasReplacement) {
    shipmentHistory.push({
      ttn: marketplaceTtn,
      carrier,
      relation: 'unknown',
      relatedTtn: delivery.ttn,
      city: destination.city,
      address: destination.address,
      source: 'marketplace',
      firstSeenAt: seenAt,
      lastSeenAt: seenAt,
    })
  }
  const ttnHistory = Array.isArray(delivery.ttnHistory) ? [...delivery.ttnHistory] : []
  if (!ttnHistory.some((ttn) => shipmentValue(ttn) === activeTtn)) ttnHistory.push(text(delivery.ttn))
  const addressHistory = Array.isArray(delivery.addressHistory) ? [...delivery.addressHistory] : []
  const oldAddress = [text(delivery.city), text(delivery.address)].filter(Boolean).join(', ')
  if (oldAddress && !addressHistory.some((address) => text(address).toLowerCase() === oldAddress.toLowerCase()))
    addressHistory.push(oldAddress)
  return { shipmentHistory, ttnHistory, addressHistory }
}
