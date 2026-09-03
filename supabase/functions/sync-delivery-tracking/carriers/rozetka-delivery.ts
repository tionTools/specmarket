import { compactEvents, parseTrackingDate, readableStatus, record, text } from '../normalize.ts'
import type { JsonRecord, TrackingResult } from '../types.ts'

function rozetkaLocation(value: JsonRecord) {
  const location = value.location
  if (typeof location === 'string' || typeof location === 'number') return text(location)
  return text(record(location).name) || text(value.city) || text(value.branch)
}

function rozetkaReadableStatus(source: string, code: string) {
  if (/поверта(?:ється|вся)|returning/i.test(source)) {
    return { status: 'Возвращается отправителю', final: false, normalizedStatus: 'returning' }
  }
  if (/(?:^|\s)у\s+відділенн/i.test(source)) {
    return {
      status: 'Готово к выдаче', final: false, normalizedStatus: 'ready_for_pickup',
    }
  }
  return readableStatus(source, code)
}

export async function rozetkaStatus(ttn: string): Promise<TrackingResult> {
  const response = await fetch(`https://rz-delivery.rozetka.ua/api/track/public/${encodeURIComponent(ttn.replace(/\s/g, ''))}`, {
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`Rozetka Delivery HTTP ${response.status}`)
  const payload = record(await response.json())
  const shipment = Array.isArray(payload.data)
    ? record(payload.data.at(0))
    : record(payload.data)
  const fallback = record(shipment.last_status)
  const statusGroups = (Array.isArray(shipment.status_groups) ? shipment.status_groups : []).map(record)
  const events = statusGroups.flatMap((group) => (Array.isArray(group.statuses) ? group.statuses : []).map(record))
  const latest = events.reduce<JsonRecord>((current, event) =>
    parseTrackingDate(event.date) >= parseTrackingDate(current.date) ? event : current,
  record(events[0]))
  const source = text(latest.name) || text(fallback.name) || text(shipment.last_status_name)
  if (!source) throw new Error('Rozetka Delivery не вернул публичный статус')
  const code = text(latest.id) || text(fallback.id) || text(shipment.last_status)
  const base = rozetkaReadableStatus(source, code)
  const finalDepartment = record(shipment.final_department)
  const finalDepartmentName = text(finalDepartment.public_name) || text(finalDepartment.name)
  const trackingEvents = compactEvents(events.map((event) => ({
    at: text(event.date),
    status: text(event.name),
    code: text(event.id),
    location: rozetkaLocation(event),
  })))
  return {
    ...base,
    status: source,
    provider: 'rozetka_delivery_public_api',
    source: 'public_tracking',
    activeTtn: ttn.replace(/\s/g, ''),
    destination: finalDepartmentName ? { address: finalDepartmentName } : undefined,
    relatedShipments: [],
    events: trackingEvents,
    details: {
      trackingEventAt: text(latest.date) || text(fallback.date) || text(shipment.last_status_date),
      trackingLocation: rozetkaLocation(latest) || rozetkaLocation(fallback) || finalDepartmentName,
      trackingStatusCode: code,
    },
  }
}
