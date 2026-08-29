import { compactEvents, latestEvent, readableStatus, record, text } from '../normalize.ts'
import type { TrackingDestination, TrackingResult } from '../types.ts'

function ukrposhtaReadableStatus(source: string, code: string, reason: string) {
  if (code === '10100') return { status: 'Принято перевозчиком', final: false, normalizedStatus: 'accepted' }
  if (code === '31300') return { status: 'Переадресовано', final: false, normalizedStatus: 'forwarding' }
  if (code === '31200') return { status: 'Возвращается отправителю', final: false, normalizedStatus: 'returning' }
  if (code === '41000' && reason === '10') return { status: 'Возвращено', final: true, normalizedStatus: 'returned' }
  if (code === '41000' || code === '48000') return { status: 'Получено', final: true, normalizedStatus: 'delivered' }
  return readableStatus(source, code)
}

function destinationFromEvent(event: Record<string, unknown>): TrackingDestination | undefined {
  const code = text(event.event)
  const reason = text(event.eventReason_id)
  // 21700 explicitly means the shipment is at the delivery point. 41000 is a destination
  // only when it is delivery to the recipient, not a return to the sender (reason 10).
  if (code !== '21700' && !(code === '41000' && reason !== '10')) return undefined
  const address = text(event.name)
  const postalCode = text(event.index)
  if (!address && !postalCode) return undefined
  return { address, locationCode: postalCode, postalCode }
}

export async function ukrposhtaStatus(ttn: string): Promise<TrackingResult> {
  const statusBearer = text(Deno.env.get('UKRPOSHTA_STATUS_BEARER'))
  if (!statusBearer) throw new Error('Не задан UKRPOSHTA_STATUS_BEARER')
  const url = new URL('https://www.ukrposhta.ua/status-tracking/0.0.1/statuses')
  url.searchParams.set('barcode', ttn.replace(/\s/g, ''))
  const response = await fetch(url, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${statusBearer}` },
  })
  if (!response.ok) throw new Error(`Укрпочта HTTP ${response.status}`)
  const data = await response.json()
  const events = (Array.isArray(data) ? data : []).map(record)
  if (!events.length) throw new Error('Укрпочта API не вернула статусы')
  const latest = latestEvent(events, 'date')
  const eventCode = text(latest.event)
  const eventReason = text(latest.eventReason_id)
  const source = text(latest.eventName) || text(latest.status) || text(latest.name)
  const base = ukrposhtaReadableStatus(source, eventCode, eventReason)
  const deliveredAt = (eventCode === '48000' || (eventCode === '41000' && eventReason !== '10'))
    ? text(latest.date)
    : ''
  const trackingEvents = compactEvents(events.map((event) => ({
    at: text(event.date),
    status: text(event.eventName),
    code: text(event.event),
    location: text(event.name),
    locationCode: text(event.index),
    country: text(event.country),
  })))
  const wasForwarded = events.some((event) => text(event.event) === '31300')
  return {
    ...base,
    status: source || base.status,
    provider: 'ukrposhta_status_api',
    source: 'carrier_api',
    activeTtn: ttn.replace(/\s/g, ''),
    relation: wasForwarded ? 'redirect' : undefined,
    destination: destinationFromEvent(latest),
    relatedShipments: [],
    events: trackingEvents,
    details: {
      trackingEventAt: text(latest.date),
      trackingLocation: text(latest.name),
      trackingLocationCode: text(latest.index),
      trackingLocationCountry: text(latest.country),
      trackingStatusCode: eventCode,
      trackingDeliveredAt: deliveredAt,
    },
  }
}
