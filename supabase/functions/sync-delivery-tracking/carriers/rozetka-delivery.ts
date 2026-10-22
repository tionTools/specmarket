import { compactEvents, parseTrackingDate, readableStatus, record, text } from '../normalize.ts'
import type { JsonRecord, TrackingResult } from '../types.ts'

function rozetkaLocation(value: JsonRecord) {
  const location = value.location
  if (typeof location === 'string' || typeof location === 'number') return text(location)
  return text(record(location).name) || text(value.city) || text(value.branch)
}

function rozetkaReadableStatus(source: string, code: string) {
  if (source.trim().toLowerCase() === 'видано') {
    return { status: source, final: true, normalizedStatus: 'delivered' }
  }
  if (/поверта(?:ється|вся)|returning/i.test(source)) {
    return { status: 'Возвращается отправителю', final: false, normalizedStatus: 'returning' }
  }
  if (/(?:^|\s)у\s+відділенн/i.test(source)) {
    return {
      status: 'Готово к выдаче',
      final: false,
      normalizedStatus: 'ready_for_pickup',
    }
  }
  return readableStatus(source, code)
}

export async function rozetkaStatus(ttn: string): Promise<TrackingResult> {
  const cleanTtn = ttn.replace(/\s/g, '')
  const response = await fetch(
    `https://rz-delivery.rozetka.ua/api/track/public/${encodeURIComponent(cleanTtn)}`,
    {
      headers: { Accept: 'application/json' },
    },
  )
  if (!response.ok) throw new Error(`Rozetka Delivery HTTP ${response.status}`)
  const payload = record(await response.json())
  const shipment = Array.isArray(payload.data) ? record(payload.data.at(0)) : record(payload.data)
  const fallback = record(shipment.last_status)
  const publicStatus = text(fallback.name) || text(shipment.last_status_name)
  const publicCode = text(fallback.id) || text(shipment.last_status)
  const publicGroups = Array.isArray(shipment.status_groups)
    ? shipment.status_groups.map(record)
    : []
  const ready =
    rozetkaReadableStatus(publicStatus, publicCode).normalizedStatus === 'ready_for_pickup' ||
    publicGroups.some(
      (group) =>
        Array.isArray(group.statuses) &&
        group.statuses.some((event) =>
          /у\s+відділенн|готов.*до\s+видачі/i.test(text(record(event).name)),
        ),
    )
  const finalDepartment = record(shipment.final_department)
  const departmentId = text(finalDepartment.id)
  const [historyResult, storeResult] = await Promise.all([
    ready && !publicGroups.length
      ? fetch(
          `https://rz-delivery.rozetka.ua/api/track/status-group?id=${encodeURIComponent(cleanTtn)}`,
        )
          .then(async (result) => (result.ok ? record(await result.json()) : {}))
          .catch(() => ({}))
      : Promise.resolve({} as JsonRecord),
    ready && departmentId
      ? fetch(
          `https://rz-delivery.rozetka.ua/api/department?id=${encodeURIComponent(departmentId)}&limit=1`,
        )
          .then(async (result) => (result.ok ? record(await result.json()) : {}))
          .catch(() => ({}))
      : Promise.resolve({} as JsonRecord),
  ])
  const history = record(historyResult)
  const store = record(storeResult)
  const historyShipment = Array.isArray(history.data)
    ? history.data.map(record).find((entry) => text(entry.track_id) === cleanTtn)
    : undefined
  const statusGroups = (
    publicGroups.length
      ? publicGroups
      : Array.isArray(historyShipment?.status_groups)
        ? historyShipment.status_groups
        : []
  ).map(record)
  const events = statusGroups.flatMap((group) =>
    (Array.isArray(group.statuses) ? group.statuses : []).map(record),
  )
  const latest = events.reduce<JsonRecord>(
    (current, event) =>
      parseTrackingDate(event.date) >= parseTrackingDate(current.date) ? event : current,
    record(events[0]),
  )
  const source = text(latest.name) || text(fallback.name) || text(shipment.last_status_name)
  if (!source) throw new Error('Rozetka Delivery не вернул публичный статус')
  const code = text(latest.id) || text(fallback.id) || text(shipment.last_status)
  const base = rozetkaReadableStatus(source, code)
  const finalDepartmentName = text(finalDepartment.public_name) || text(finalDepartment.name)
  const confirmedStore =
    Array.isArray(store.data) &&
    store.data
      .map(record)
      .some(
        (department) =>
          text(department.id) === departmentId &&
          ['точка видачі', 'магазин'].includes(
            text(record(department.department_type).name).toLowerCase(),
          ),
      )
  const readyEvents = events.filter(
    (event) => /у\s+відділенн|готов.*до\s+видачі/i.test(text(event.name)) && text(event.date),
  )
  const arrivedAt = readyEvents.sort(
    (a, b) => parseTrackingDate(a.date) - parseTrackingDate(b.date),
  )[0]
  const trackingEvents = compactEvents(
    events.map((event) => ({
      at: text(event.date),
      status: text(event.name),
      code: text(event.id),
      location: rozetkaLocation(event),
    })),
  )
  return {
    ...base,
    status: source,
    provider: 'rozetka_delivery_public_api',
    source: 'public_tracking',
    activeTtn: cleanTtn,
    destination: finalDepartmentName ? { address: finalDepartmentName } : undefined,
    relatedShipments: [],
    events: trackingEvents,
    details: {
      trackingEventAt: text(latest.date) || text(fallback.date) || text(shipment.last_status_date),
      trackingLocation: rozetkaLocation(latest) || rozetkaLocation(fallback) || finalDepartmentName,
      trackingStatusCode: code,
      trackingPickupArrivedAt: arrivedAt ? text(arrivedAt.date) : undefined,
      trackingPickupLocationType: confirmedStore ? 'rozetka_store' : undefined,
    },
  }
}
