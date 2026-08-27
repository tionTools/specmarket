import { compactEvents, latestEvent, readableStatus, record, text } from '../normalize.ts'
import type { TrackingResult } from '../types.ts'

function meestReadableStatus(source: string, code: string) {
  if (code === '2') return { status: 'Создана накладная', final: false, normalizedStatus: 'created' }
  if (code === '1622' || /^доручено$/i.test(source.trim()))
    return { status: 'Получено', final: true, normalizedStatus: 'delivered' }
  return readableStatus(source, code)
}

export async function meestStatus(ttn: string): Promise<TrackingResult> {
  const apiToken = text(Deno.env.get('MEEST_API_TOKEN'))
  if (!apiToken) throw new Error('Не задан MEEST_API_TOKEN')
  const trackNumber = encodeURIComponent(ttn.replace(/\s/g, ''))
  const response = await fetch(`https://api.meest.com/v3.0/openAPI/tracking/${trackNumber}`, {
    headers: { Accept: 'application/json', token: apiToken },
  })
  if (!response.ok) throw new Error(`Meest HTTP ${response.status}`)
  const raw = record(await response.json())
  const events = (Array.isArray(raw.result) ? raw.result : []).map(record)
  const latest = latestEvent(events, 'eventDateTime')
  const source = text(record(latest?.eventDescr).descrUA) || text(latest?.eventDescr) || text(raw.status)
  if (!source) throw new Error('Meest API не вернул статус')
  const eventCode = text(latest?.eventCode)
  const base = meestReadableStatus(source, eventCode)
  const final = /^(1622|1825|3|5700)$/.test(eventCode) || base.final
  const trackingEvents = compactEvents(events.map((event) => ({
    at: text(event.eventDateTime),
    status: text(record(event.eventDescr).descrUA) || text(event.eventDescr),
    code: text(event.eventCode),
    location: text(record(event.eventCityDescr).descrUA),
    country: text(record(event.eventCountryDescr).descrUA),
  })))
  return {
    ...base,
    status: base.normalizedStatus === 'delivered' ? base.status : source,
    final,
    provider: 'meest_api',
    details: {
      trackingEventAt: text(latest?.eventDateTime),
      trackingLocation: text(record(latest?.eventCityDescr).descrUA),
      trackingLocationCountry: text(record(latest?.eventCountryDescr).descrUA),
      trackingLocationDetails: text(record(latest?.eventDetailDescr).descrUA),
      trackingStatusCode: eventCode,
      trackingDeliveredAt: eventCode === '1622' ? text(latest?.eventDateTime) : '',
      trackingEvents,
    },
  }
}
