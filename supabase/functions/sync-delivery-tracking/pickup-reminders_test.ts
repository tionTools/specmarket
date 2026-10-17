import { automaticPickupDeadline } from './pickup-reminders.ts'
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
  assertEquals(automaticPickupDeadline({ ...base, trackingNormalizedStatus: 'returning' }), null)
  assertEquals(automaticPickupDeadline({ ...base, trackingNormalizedStatus: 'in_transit' }), null)
})
Deno.test('ROZETKA store uses its separate ten-calendar-day policy', () => {
  assertEquals(automaticPickupDeadline({ ...base, carrier: 'ROZETKA Delivery',
    trackingPickupLocationType: 'rozetka_store' })?.date, '2026-10-26')
  assertEquals(automaticPickupDeadline({ ...base, carrier: 'ROZETKA Delivery',
    trackingPickupLocationType: '' }), null)
})
Deno.test('Meest working days vary by verified depot type', () => {
  const meest = { ...base, carrier: 'Meest', trackingPickupArrivedAt: '2026-10-16' }
  assertEquals(automaticPickupDeadline(meest), null)
  assertEquals(automaticPickupDeadline({ ...meest,
    trackingPickupLocationType: 'meest_apt' })?.date, '2026-10-23')
  assertEquals(automaticPickupDeadline({ ...meest,
    trackingPickupLocationType: 'meest_warehouse' })?.date, '2026-10-30')
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
