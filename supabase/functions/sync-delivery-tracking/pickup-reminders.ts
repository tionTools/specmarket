import { carrierKind } from './carrier-detection.ts'
import type { CarrierKind, JsonRecord } from './types.ts'

// Calendar dates are always the carrier's local (Ukraine) service dates. The
// scheduled-delivery ETA is never a valid pickup-storage start.
function day(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/)
  const local = raw.match(/^(\d{2})[.\/-](\d{2})[.\/-](\d{4})(?:[T\s].*)?$/)
  const year = Number(iso?.[1] ?? local?.[3])
  const month = Number(iso?.[2] ?? local?.[2])
  const date = Number(iso?.[3] ?? local?.[1])
  if (!year || !month || !date) return null
  const result = new Date(Date.UTC(year, month - 1, date))
  return result.getUTCFullYear() === year && result.getUTCMonth() === month - 1
    && result.getUTCDate() === date ? result : null
}

function isoDate(date: Date) { return date.toISOString().slice(0, 10) }

function addDays(start: Date, days: number) {
  const value = new Date(start.getTime())
  value.setUTCDate(value.getUTCDate() + days)
  return value
}

function addWeekdays(start: Date, days: number) {
  let current = new Date(start.getTime())
  for (let count = 0; count < days;) {
    current = addDays(current, 1)
    if (current.getUTCDay() !== 0 && current.getUTCDay() !== 6) count++
  }
  return current
}

function text(value: unknown) { return typeof value === 'string' ? value.trim() : '' }

export type PickupDeadline = { date: string; carrier: CarrierKind; basis: string }

// This function fails closed when type, arrival, or the actual auto-return
// policy is not verified. Free-storage duration is NEVER assumed to equal
// auto-return duration. Per-parcel manual overrides live in the database.
export function automaticPickupDeadline(delivery: JsonRecord): PickupDeadline | null {
  const carrier = carrierKind(delivery)
  const status = text(delivery.trackingNormalizedStatus).toLowerCase()
  if (!carrier || status !== 'ready_for_pickup'
    || delivery.trackingBuyerReceived === true || delivery.trackingReturnInProgress === true) return null

  // Only tracking-derived pickup arrivals are acceptable; not the estimated
  // delivery day nor the CRM's first observation timestamp.
  const arrival = day(delivery.trackingPickupArrivedAt)
  if (!arrival) return null
  const explicit = day(delivery.trackingVerifiedLastPickupAt)
  if (explicit && delivery.trackingVerifiedLastPickupSource === 'carrier_api')
    return { date: isoDate(explicit), carrier, basis: 'carrier_explicit' }

  if (carrier === 'nova') {
    // This is an explicitly supplied SpecMarket business setting: 5 calendar
    // storage days after arrival; automatic return starts on day 6. A changed
    // business policy or storage extension needs a verified manual override.
    return { date: isoDate(addDays(arrival, 5)), carrier, basis: 'specmarket_five_day_auto_return' }
  }
  if (carrier === 'rozetka' && delivery.trackingPickupLocationType === 'rozetka_store') {
    // Carrier help: 10 days in ROZETKA store, counted here with arrival as
    // day one. Verify the exact parcel-specific expiry if it is supplied.
    return { date: isoDate(addDays(arrival, 9)), carrier, basis: 'rozetka_store_ten_days' }
  }
  if (carrier === 'meest') {
    // Meest differentiates APT/<=10 kg from warehouse/<=30 kg. Do not choose
    // a duration from the carrier name alone; service type must be verified.
    const depot = text(delivery.trackingPickupLocationType)
    if (depot === 'meest_apt')
      return { date: isoDate(addWeekdays(arrival, 5)), carrier, basis: 'meest_apt_five_workdays' }
    if (depot === 'meest_warehouse')
      return { date: isoDate(addWeekdays(arrival, 10)), carrier, basis: 'meest_warehouse_ten_workdays' }
  }
  // Ukrposhta 7 urban / 14 rural days specify the FREE interval, not a
  // universal auto-return deadline. Their policy needs a verified per-parcel
  // return-after-storage option, represented by trackingVerifiedLastPickupAt.
  return null
}
