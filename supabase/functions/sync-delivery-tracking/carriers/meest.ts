import { createHash } from 'node:crypto'
import { compactEvents, latestEvent, parseTrackingDate, readableStatus, record, text } from '../normalize.ts'
import type { TrackingResult } from '../types.ts'

type PublicTrackingEvent = {
  at: string
  status: string
  detail: string
  code: string
  location: string
  country: string
}

function meestReadableStatus(source: string, code: string) {
  if (code === '2') return { status: 'Создана накладная', final: false, normalizedStatus: 'created' }
  if (code === '606' || /(?:прийнято до перевезення|принято к перевозке)/i.test(source))
    return { status: 'Принято перевозчиком', final: false, normalizedStatus: 'accepted' }
  if (code === '8081') return { status: 'На пути к получателю', final: false, normalizedStatus: 'in_transit' }
  if (code === '1622' || /^доручено$/i.test(source.trim()))
    return { status: 'Получено', final: true, normalizedStatus: 'delivered' }
  return readableStatus(source, code)
}

function decodeXml(value: string) {
  return value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (match, entity: string) => {
    switch (entity.toLowerCase()) {
      case 'amp': return '&'
      case 'lt': return '<'
      case 'gt': return '>'
      case 'quot': return '"'
      case 'apos': return "'"
      default: {
        const hex = entity[1]?.toLowerCase() === 'x'
        const source = hex ? entity.slice(2) : entity.slice(1)
        const codePoint = Number.parseInt(source, hex ? 16 : 10)
        return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : match
      }
    }
  })
}

function xmlValue(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'))
  return match ? decodeXml(match[1]).replace(/\s+/g, ' ').trim() : ''
}

function publicTrackingEvents(xml: string): PublicTrackingEvent[] {
  return Array.from(xml.matchAll(/<items>([\s\S]*?)<\/items>/gi), (match) => {
    const block = match[1]
    const action = xmlValue(block, 'ActionMessages')
    const detail = xmlValue(block, 'DetailMessages')
    return {
      at: xmlValue(block, 'DateTimeAction'),
      status: [action, detail].filter(Boolean).join(' ').trim(),
      detail,
      code: xmlValue(block, 'StatusCode'),
      location: xmlValue(block, 'City'),
      country: xmlValue(block, 'Country'),
    }
  }).filter((event) => event.at && event.status)
}

function latestPublicTrackingEvent(events: PublicTrackingEvent[]) {
  return events.reduce((current, event) =>
    parseTrackingDate(event.at) >= parseTrackingDate(current.at) ? event : current,
  events[0])
}

async function meestPublicTrackingStatus(ttn: string): Promise<TrackingResult> {
  const normalizedTtn = ttn.replace(/\s/g, '')
  const pageResponse = await fetch(`https://t.meest-group.com/n/${encodeURIComponent(normalizedTtn)}`, {
    headers: { Accept: 'text/html' },
  })
  if (!pageResponse.ok) throw new Error(`Meest public page HTTP ${pageResponse.status}`)
  const page = await pageResponse.text()
  const salt = page.match(/\bvar\s+salt\s*=\s*['"]([0-9a-f]{16,128})['"]/i)?.[1]
  if (!salt) throw new Error('Meest public tracking не вернул salt')

  const check = createHash('md5').update(`${salt}${normalizedTtn}${salt}`).digest('hex')
  const trackingUrl = `https://t.meest-group.com/get.php?what=tracking&test&number=${encodeURIComponent(normalizedTtn)}&lang=uk&ext_track=&chk=${check}`
  const trackingResponse = await fetch(trackingUrl, {
    method: 'POST',
    headers: { Accept: 'application/xml, text/xml, */*' },
  })
  if (!trackingResponse.ok) throw new Error(`Meest public tracking HTTP ${trackingResponse.status}`)

  const events = publicTrackingEvents(await trackingResponse.text())
  if (!events.length) throw new Error('Meest public tracking не вернул события')
  const latest = latestPublicTrackingEvent(events)
  const base = meestReadableStatus(latest.status, latest.code)
  const final = /^(1622|1825|3|5700)$/.test(latest.code) || base.final
  return {
    ...base,
    status: base.normalizedStatus === 'delivered' ? base.status : latest.status,
    final,
    provider: 'meest_public_tracking',
    source: 'public_tracking',
    activeTtn: normalizedTtn,
    relatedShipments: [],
    events: compactEvents(events.map((event) => ({
      at: event.at,
      status: event.status,
      code: event.code,
      location: event.location,
      country: event.country,
    }))),
    details: {
      trackingEventAt: latest.at,
      trackingLocation: latest.location,
      trackingLocationCountry: latest.country,
      trackingLocationDetails: latest.detail,
      trackingStatusCode: latest.code,
      trackingDeliveredAt: latest.code === '1622' ? latest.at : '',
    },
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
  if (!events.length) {
    try {
      return await meestPublicTrackingStatus(ttn)
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'неизвестная ошибка'
      throw new Error(`Meest OpenAPI не вернул события; public tracking: ${reason}`)
    }
  }

  const latest = latestEvent(events, 'eventDateTime')
  const responseStatus = text(raw.status)
  const source = text(record(latest?.eventDescr).descrUA) || text(latest?.eventDescr) || responseStatus
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
