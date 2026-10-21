import { automaticPickupDeadline, shouldSyncAutomaticPickupReminder } from './pickup-reminders.ts'
import { rozetkaStatus } from './carriers/rozetka-delivery.ts'
import { assertEquals } from 'jsr:@std/assert@1'

const base = { carrier: 'Нова пошта', ttn: '20450000000000',
  trackingNormalizedStatus: 'ready_for_pickup', trackingPickupArrivedAt: '17.10.2026 12:05' }

Deno.test('SpecMarket confirmed NP day 1 starts after arrival; day 6 returns', () => {
  assertEquals(automaticPickupDeadline(base)?.date, '2026-10-22')
})
Deno.test('no arrival, or scheduled delivery estimate only, never infers deadline', () => {
  assertEquals(automaticPickupDeadline({ ...base, trackingPickupArrivedAt: undefined,
    trackingExpectedDeliveryAt: '17.10.2026' }), null)
})
Deno.test('received and return-in-progress cannot be reminded', () => {
  assertEquals(automaticPickupDeadline({ ...base, trackingBuyerReceived: true }), null)
  assertEquals(automaticPickupDeadline({ ...base, trackingReturnInProgress: true }), null)
  assertEquals(automaticPickupDeadline({ ...base, trackingNormalizedStatus: 'returning' }), null)
  assertEquals(automaticPickupDeadline({ ...base, trackingNormalizedStatus: 'in_transit' }), null)
})
Deno.test('ROZETKA store uses its separate ten-calendar-day policy', () => {
  assertEquals(automaticPickupDeadline({ ...base, carrier: 'ROZETKA Delivery',
    trackingPickupLocationType: 'rozetka_store' })?.date, '2026-10-26')
  assertEquals(automaticPickupDeadline({ ...base, carrier: 'ROZETKA Delivery',
    trackingPickupLocationType: '' }), null)
})
Deno.test('Meest reminders use five calendar days for all delivery point types', () => {
  const meest = { ...base, carrier: 'Meest', trackingPickupArrivedAt: '2026-10-16' }
  for (const type of [undefined, 'meest_apt', 'meest_warehouse', 'meest_parcel_locker']) {
    const result = automaticPickupDeadline({ ...meest, trackingPickupLocationType: type })
    assertEquals(result?.date, '2026-10-21')
    assertEquals(result?.basis, 'specmarket_meest_five_calendar_day_reminder')
  }
  const explicit = automaticPickupDeadline({ ...meest,
    trackingVerifiedLastPickupAt: '2026-10-30', trackingVerifiedLastPickupSource: 'carrier_api' })
  assertEquals(explicit?.date, '2026-10-30')
  assertEquals(explicit?.basis, 'carrier_explicit')
  assertEquals(automaticPickupDeadline({ ...meest, trackingPickupArrivedAt: undefined }), null)
  assertEquals(automaticPickupDeadline({ ...meest, trackingNormalizedStatus: 'delivered' }), null)
})
Deno.test('Ukrposhta free storage term is not a default auto-return date', () => {
  const ukr = { ...base, carrier: 'Укрпошта' }
  assertEquals(automaticPickupDeadline(ukr), null)
  assertEquals(automaticPickupDeadline({ ...ukr,
    trackingVerifiedLastPickupAt: '2026-10-24' }), null)
  assertEquals(automaticPickupDeadline({ ...ukr,
    trackingVerifiedLastPickupAt: '2026-10-24',
    trackingVerifiedLastPickupSource: 'carrier_api' })?.date, '2026-10-24')
})

Deno.test('Nova Poshta HH:mm DD.MM.YYYY arrival is used for the deadline', () => {
  assertEquals(automaticPickupDeadline({ ...base,
    trackingPickupArrivedAt: '17:15 16.10.2026' })?.date, '2026-10-21')
  assertEquals(automaticPickupDeadline({ ...base,
    trackingPickupArrivedAt: '17:15:09 16.10.2026' })?.date, '2026-10-21')
  assertEquals(automaticPickupDeadline({ ...base,
    trackingPickupArrivedAt: '23:59 29.10.2026' })?.date, '2026-11-03')
})
Deno.test('reject malformed or impossible time-first dates, without falling back to ETA', () => {
  for (const arrival of ['24:15 16.10.2026', '17:60 16.10.2026',
    '17:15 31.02.2026', '17:15 16.13.2026', 'foo 17:15 16.10.2026']) {
    assertEquals(automaticPickupDeadline({ ...base, trackingPickupArrivedAt: arrival,
      trackingExpectedDeliveryAt: '2026-10-16' }), null)
  }
})

Deno.test('previous tracking key does not hide a missing reminder database row', () => {
  const computed = automaticPickupDeadline(base)
  const key = '20450000000000:2026-10-22:specmarket_five_day_auto_return'
  assertEquals(shouldSyncAutomaticPickupReminder(computed, base.ttn, key, undefined), true)
  assertEquals(shouldSyncAutomaticPickupReminder(computed, base.ttn, key,
    { ttn: base.ttn, deadline: '2026-10-22', source: 'carrier_rule' }), false)
  assertEquals(shouldSyncAutomaticPickupReminder(computed, base.ttn, key,
    { ttn: base.ttn, deadline: '2026-10-21', source: 'carrier_rule' }), true)
  assertEquals(shouldSyncAutomaticPickupReminder(computed, base.ttn, key,
    { ttn: base.ttn, deadline: '2026-10-24', source: 'manual' }), false)
  assertEquals(shouldSyncAutomaticPickupReminder(null, base.ttn, key, undefined), false)
})

const rozetkaTtn = 'PRM-870751442'
const departmentId = '1311ecb8-e18a-4f4c-9429-94b278401e47'
const publicTrack = { data: {
  last_status: 40040, last_status_name: 'У відділенні', last_status_date: '2026-10-18 15:05:25',
  final_department: { id: departmentId, name: '', public_name: '' },
  delivery_date: '2026-10-17 16:00:00',
} }
const history = { data: [{ track_id: rozetkaTtn, status_groups: [{ statuses: [
  { id: 40040, name: 'Готово до видачі', date: '2026-10-17 15:11:59' },
  { id: 40040, name: 'Готово до видачі', date: '2026-10-18 15:05:25' },
] }] }] }
const store = { data: [{ id: departmentId, department_type: { name: 'Точка видачі' } }] }

async function withRozetkaResponses(historyResponse: unknown, departmentResponse: unknown, run: () => Promise<void>) {
  const previousFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    const url = String(input)
    const body = url.includes('/track/status-group?') ? historyResponse
      : url.includes('/api/department?') ? departmentResponse : publicTrack
    return new Response(JSON.stringify(body))
  }
  try { await run() } finally { globalThis.fetch = previousFetch }
}

Deno.test('ROZETKA empty department name uses directory type and first ready scan', async () => {
  await withRozetkaResponses(history, store, async () => {
    const result = await rozetkaStatus(rozetkaTtn)
    assertEquals(result.normalizedStatus, 'ready_for_pickup')
    assertEquals(result.details?.trackingPickupLocationType, 'rozetka_store')
    assertEquals(result.details?.trackingPickupArrivedAt, '2026-10-17 15:11:59')
    const delivery = { carrier: 'Магазины Rozetka', ttn: rozetkaTtn,
      trackingNormalizedStatus: result.normalizedStatus, ...result.details }
    const deadline = automaticPickupDeadline(delivery)
    assertEquals(deadline?.date, '2026-10-26')
    const key = `${rozetkaTtn}:2026-10-26:rozetka_store_ten_days`
    assertEquals(shouldSyncAutomaticPickupReminder(deadline, rozetkaTtn, '', undefined), true)
    assertEquals(shouldSyncAutomaticPickupReminder(deadline, rozetkaTtn, key,
      { ttn: rozetkaTtn, deadline: '2026-10-26', source: 'carrier_rule' }), false)
    assertEquals(shouldSyncAutomaticPickupReminder(deadline, rozetkaTtn, key,
      { ttn: rozetkaTtn, deadline: '2026-10-28', source: 'manual' }), false)
    assertEquals(automaticPickupDeadline({ ...delivery,
      trackingVerifiedLastPickupAt: '2026-10-25', trackingVerifiedLastPickupSource: 'carrier_api' })?.date,
    '2026-10-25')
  })
})

Deno.test('ROZETKA unknown point or parcel locker never gets store deadline', async () => {
  for (const directory of [{ data: [] }, { data: [{ id: departmentId,
    department_type: { name: 'Поштомат' } }] }]) {
    await withRozetkaResponses(history, directory, async () => {
      const result = await rozetkaStatus(rozetkaTtn)
      assertEquals(result.details?.trackingPickupLocationType, undefined)
      assertEquals(automaticPickupDeadline({ carrier: 'Магазины Rozetka', ttn: rozetkaTtn,
        trackingNormalizedStatus: result.normalizedStatus, ...result.details }), null)
    })
  }
})

Deno.test('ROZETKA does not infer arrival from a later public status or delivery estimate', async () => {
  await withRozetkaResponses({ data: [] }, store, async () => {
    const result = await rozetkaStatus(rozetkaTtn)
    assertEquals(result.details?.trackingPickupArrivedAt, undefined)
    assertEquals(automaticPickupDeadline({ carrier: 'Магазины Rozetka', ttn: rozetkaTtn,
      trackingNormalizedStatus: result.normalizedStatus, ...result.details }), null)
  })
})
