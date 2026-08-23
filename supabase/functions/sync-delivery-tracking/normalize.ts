import type { JsonRecord, TrackingEvent, TrackingResult } from './types.ts'

export function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

export function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : value === null || value === undefined ? '' : String(value).trim()
}

export function isFinal(status: string) {
  return /(отримано|получено|доставлено|вручено|завершено|повернено|возвращено|скасовано|отменено|відмінен|cancel|return|received|delivered)/i.test(status)
}

export function readableStatus(source: string, code = ''): TrackingResult {
  const value = source.trim()
  const normalized = `${value} ${code}`.toLowerCase()
  if (/return|повернен|41010|31200/.test(normalized)) return { status: 'Возвращено', final: true, normalizedStatus: 'returned' }
  if (/cancel|скасован|відмінен|10600|10602|102|103/.test(normalized)) return { status: 'Отменено', final: true, normalizedStatus: 'cancelled' }
  if (/receivedwarehouse|received|отриман|получен|вручено|доставлено|41000|\b9\b|\b10\b|\b11\b/.test(normalized)) return { status: 'Получено', final: true, normalizedStatus: 'delivered' }
  if (/arriv.*recipient|прибул.*відділен|готов.*видач|очіку.*отрим|arrived|21700|\b7\b|\b8\b/.test(normalized)) return { status: 'Готово к выдаче', final: false, normalizedStatus: 'ready_for_pickup' }
  if (/createid|оформив|заплан|10100|\b1\b/.test(normalized)) return { status: 'Запланировано', final: false, normalizedStatus: 'created' }
  if (/warehouse|прийнял|принят|accept|registered/.test(normalized)) return { status: 'Принято перевозчиком', final: false, normalizedStatus: 'accepted' }
  if (/way|route|виїхал|виїхала|руха|дороз|пряму|відправлен|deliver|20700|20800|20900|21500|101/.test(normalized)) return { status: 'На пути к получателю', final: false, normalizedStatus: 'in_transit' }
  return { status: value || 'Запланировано', final: isFinal(value), normalizedStatus: 'unknown' }
}

export function compactEvents(events: TrackingEvent[]) {
  return events.filter((event) => Object.values(event).some(Boolean)).slice(-30)
}

export function parseTrackingDate(value: unknown) {
  const source = text(value)
  const match = source.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/)
  if (match) {
    const [, year, month, day, hour = '0', minute = '0', second = '0'] = match
    return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))
  }
  const ukrainianMatch = source.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/)
  if (ukrainianMatch) {
    const [, day, month, year, hour = '0', minute = '0', second = '0'] = ukrainianMatch
    return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))
  }
  return Number.NEGATIVE_INFINITY
}

export function latestEvent(events: JsonRecord[], dateField: string) {
  return events.reduce<JsonRecord>((current, event) =>
    parseTrackingDate(event[dateField]) > parseTrackingDate(current[dateField]) ? event : current,
  record(events[0]))
}
