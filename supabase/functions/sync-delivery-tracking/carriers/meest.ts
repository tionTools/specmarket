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

const md5Shift = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
]
const md5Constants = Array.from(
  { length: 64 },
  (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0,
)

function rotateLeft(value: number, amount: number) {
  return ((value << amount) | (value >>> (32 - amount))) >>> 0
}

function md5Hex(value: string) {
  const bytes = new TextEncoder().encode(value)
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64
  const padded = new Uint8Array(paddedLength)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const bitLength = BigInt(bytes.length) * 8n
  for (let index = 0; index < 8; index += 1)
    padded[paddedLength - 8 + index] = Number((bitLength >> BigInt(index * 8)) & 0xffn)

  const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength)
  let a0 = 0x67452301
  let b0 = 0xefcdab89
  let c0 = 0x98badcfe
  let d0 = 0x10325476

  for (let offset = 0; offset < paddedLength; offset += 64) {
    const words = Array.from({ length: 16 }, (_, index) => view.getUint32(offset + index * 4, true))
    let a = a0
    let b = b0
    let c = c0
    let d = d0

    for (let index = 0; index < 64; index += 1) {
      let f: number
      let wordIndex: number
      if (index < 16) {
        f = (b & c) | (~b & d)
        wordIndex = index
      } else if (index < 32) {
        f = (d & b) | (~d & c)
        wordIndex = (5 * index + 1) % 16
      } else if (index < 48) {
        f = b ^ c ^ d
        wordIndex = (3 * index + 5) % 16
      } else {
        f = c ^ (b | ~d)
        wordIndex = (7 * index) % 16
      }
      const previousD = d
      d = c
      c = b
      const sum = (a + f + md5Constants[index]! + words[wordIndex]!) >>> 0
      b = (b + rotateLeft(sum, md5Shift[index]!)) >>> 0
      a = previousD
    }

    a0 = (a0 + a) >>> 0
    b0 = (b0 + b) >>> 0
    c0 = (c0 + c) >>> 0
    d0 = (d0 + d) >>> 0
  }

  return [a0, b0, c0, d0].map((word) =>
    [0, 8, 16, 24]
      .map((shift) => ((word >>> shift) & 0xff).toString(16).padStart(2, '0'))
      .join('')
  ).join('')
}

function meestReadableStatus(source: string, code: string) {
  const status = source.replace(/\s+/g, ' ').trim()
  if (code === '2') return { status: 'Создана накладная', final: false, normalizedStatus: 'created' }
  if (code === '606' || /(?:прийнято до перевезення|принято к перевозке)/i.test(status))
    return { status: 'Принято перевозчиком', final: false, normalizedStatus: 'accepted' }
  if (code === '8081') return { status: 'На пути к получателю', final: false, normalizedStatus: 'in_transit' }
  if (code === '11') return { status: source, final: false, normalizedStatus: 'in_transit' }
  if (
    code === '1622' ||
    /^доручено$/i.test(status) ||
    /^(?:відправлення\s+)?(?:отримане|одержане|вручене)(?:$|[\s.,;:()])/iu.test(status) ||
    /^(?:отправление\s+)?(?:получено|вручено|доставлено)(?:$|[\s.,;:()])/iu.test(status)
  )
    return { status: 'Получено', final: true, normalizedStatus: 'delivered' }
  if (/(?:готове\s+до\s+видачі|готово\s+к\s+выдаче)/iu.test(status))
    return { status: 'Готово к выдаче', final: false, normalizedStatus: 'ready_for_pickup' }
  if (/(?:видан[ео]\s+кур['’ʼ]?єру|выдано\s+курьеру|прямує\s+у\s+підрозділ\s+отримання)/iu.test(status))
    return { status: source, final: false, normalizedStatus: 'in_transit' }
  const fallback = readableStatus(source, code)
  return fallback.normalizedStatus === 'delivered'
    ? { status: source, final: false, normalizedStatus: 'unknown' }
    : fallback
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
  return match ? decodeXml(match[1] ?? '').replace(/\s+/g, ' ').trim() : ''
}

function publicTrackingEvents(xml: string): PublicTrackingEvent[] {
  return Array.from(xml.matchAll(/<items>([\s\S]*?)<\/items>/gi), (match) => {
    const block = match[1] ?? ''
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
  events[0]!)
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

  const check = md5Hex(`${salt}${normalizedTtn}${salt}`)
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
      trackingDeliveredAt: base.normalizedStatus === 'delivered' ? latest.at : '',
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
      trackingDeliveredAt: base.normalizedStatus === 'delivered' ? text(latest?.eventDateTime) : '',
    },
  }
}
