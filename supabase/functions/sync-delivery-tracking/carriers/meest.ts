import { compactEvents, latestEvent, readableStatus, record, text } from '../normalize.ts'
import type { TrackingResult } from '../types.ts'

function meestReadableStatus(source: string, code: string) {
  if (code === '2') return { status: 'Создана накладная', final: false, normalizedStatus: 'created' }
  if (code === '1622' || /^доручено$/i.test(source.trim()))
    return { status: 'Получено', final: true, normalizedStatus: 'delivered' }
  if (/прийнят/i.test(source))
    return { status: 'Принято перевозчиком', final: false, normalizedStatus: 'accepted' }
  return readableStatus(source, code)
}

async function meestPublicTrackingStatus(ttn: string): Promise<TrackingResult | null> {
  try {
    const url = new URL('https://t.meest-group.com/get.php')
    url.searchParams.set('what', 'tracking_info_n')
    url.searchParams.set('out', 'json')
    url.searchParams.set('lang', 'uk')
    url.searchParams.set('number', ttn.replace(/\s/g, ''))
    const response = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!response.ok) return null
    const data = record(await response.json())
    const source = text(data.condition) || text(data.status) || text(data.status_name) || text(data.state)
    if (!source || /^ok$/i.test(source)) return null
    const base = meestReadableStatus(source, '')
    return {
      ...base,
      status: base.normalizedStatus === 'delivered' ? base.status : source,
      provider: 'meest_public_tracking',
      source: 'public_tracking',
      activeTtn: ttn.replace(/\s/g, ''),
    }
  } catch {
    return null
  }
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
  const responseStatus = text(raw.status)
  const createdWithoutEvents = events.length === 0 && /^ok$/i.test(responseStatus)
  if (createdWithoutEvents) {
    const publicTracking = await meestPublicTrackingStatus(ttn)
    if (publicTracking) return publicTracking
  }
  const source = createdWithoutEvents
    ? 'Отправление создано, но не передано на доставку'
    : text(record(latest?.eventDescr).descrUA) || text(latest?.eventDescr) || responseStatus
  if (!source) throw new Error('Meest API не вернул статус')
  const eventCode = text(latest?.eventCode)
  const base = createdWithoutEvents
    ? { status: source, final: false, normalizedStatus: 'created' }
    : meestReadableStatus(source, eventCode)
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
    source: 'carrier_api',
    activeTtn: ttn.replace(/\s/g, ''),
    // The current v3 endpoint exposes event cities. It does not document them as the
    // recipient's final pickup point, so no destination is derived from eventCityDescr.
    relatedShipments: [],
    events: trackingEvents,
    details: {
      trackingEventAt: text(latest?.eventDateTime),
      trackingLocation: text(record(latest?.eventCityDescr).descrUA),
      trackingLocationCountry: text(record(latest?.eventCountryDescr).descrUA),
      trackingLocationDetails: text(record(latest?.eventDetailDescr).descrUA),
      trackingStatusCode: eventCode,
      trackingDeliveredAt: eventCode === '1622' ? text(latest?.eventDateTime) : '',
    },
  }
}
