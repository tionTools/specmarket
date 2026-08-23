import { compactEvents, latestEvent, readableStatus, record, text } from '../normalize.ts'
import type { TrackingResult } from '../types.ts'

function ukrposhtaReadableStatus(source: string, code: string, reason: string) {
  if (code === '10100') return { status: 'Принято перевозчиком', final: false, normalizedStatus: 'accepted' }
  if (code === '31200') return { status: 'Возвращается отправителю', final: false, normalizedStatus: 'returning' }
  if (code === '41000' && reason === '10') return { status: 'Возвращено', final: true, normalizedStatus: 'returned' }
  if (code === '41000' || code === '48000') return { status: 'Получено', final: true, normalizedStatus: 'delivered' }
  return readableStatus(source, code)
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
  return {
    ...base,
    status: source || base.status,
    provider: 'ukrposhta_status_api',
    details: {
      trackingEventAt: text(latest.date),
      trackingLocation: text(latest.name),
      trackingLocationCode: text(latest.index),
      trackingLocationCountry: text(latest.country),
      trackingStatusCode: eventCode,
      trackingDeliveredAt: deliveredAt,
      trackingEvents: compactEvents(events.map((event) => ({
        at: text(event.date),
        status: text(event.eventName),
        code: text(event.event),
        location: text(event.name),
        locationCode: text(event.index),
        country: text(event.country),
      }))),
    },
  }
}
