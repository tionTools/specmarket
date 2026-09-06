import { usdRateForDate } from './currency-rate.ts'
import { resolvedOrderItemCost } from './price-cost.ts'
import { currencyRateForDate, localDateKey } from '../../../src/features/prices/currencyRates.ts'

function assertEquals(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) throw new Error(`${message}: ${actual} !== ${expected}`)
}

const rates = [
  { effectiveFrom: '2000-01-01', rate: 45.2 },
  { effectiveFrom: '2026-09-10', rate: 46 },
  { effectiveFrom: '2026-10-01', rate: 46.5 },
]

assertEquals(usdRateForDate(rates, '09.09.2026'), 45.2, 'rate before change')
assertEquals(usdRateForDate(rates, '10.09.2026'), 46, 'rate on effective date')
assertEquals(usdRateForDate(rates, '2026-09-30T21:00:00Z'), 46, 'ISO timestamp')
assertEquals(usdRateForDate(rates, '01.10.2026'), 46.5, 'next rate')
assertEquals(usdRateForDate(rates, '1999-12-31', 44), 44, 'fallback before first rate')

const usdLinked = { priceItemId: 'price-usd', cost: 0, costUsd: 10 }
assertEquals(
  resolvedOrderItemCost(undefined, usdLinked, usdRateForDate(rates, '09.09.2026')).cost,
  452,
  'USD cost before rate change',
)
assertEquals(
  resolvedOrderItemCost(undefined, usdLinked, usdRateForDate(rates, '10.09.2026')).cost,
  460,
  'USD cost on rate effective date',
)
const preserved = resolvedOrderItemCost(
  { cost: 429, cost_usd: 0, cost_manual: false },
  usdLinked,
  46,
)
assertEquals(preserved.cost, 429, 'existing nonzero historical cost stays frozen')

for (const rate of [0, -1, NaN, Infinity]) {
  const pending = resolvedOrderItemCost(undefined, usdLinked, rate)
  assertEquals(pending.cost, 0, 'missing rate leaves UAH untouched')
  assertEquals(pending.costUsd, 0, 'missing rate leaves USD eligible for later autofill')
  assertEquals(pending.priceItemId, 'price-usd', 'price link is retained while rate is missing')
  assertEquals(resolvedOrderItemCost(pending, usdLinked, 46).cost, 460, 'retry after rate appears')
}
assertEquals(resolvedOrderItemCost({ cost_manual: true, cost: 0 }, usdLinked, 46).cost, 0, 'manual zero preserved')
assertEquals(resolvedOrderItemCost({ cost: 0, cost_usd: 10 }, usdLinked, 46).costUsd, 10, 'historical USD preserved')
assertEquals(usdRateForDate([], '2026-09-10'), 0, 'empty schedule has no fictional rate')

const frontendRates = rates.map((row) => ({ effective_from: row.effectiveFrom, rate: row.rate }))
assertEquals(currencyRateForDate(frontendRates, '2026-09-09') * 10, 452, 'draft before date change')
assertEquals(currencyRateForDate(frontendRates, '2026-09-10') * 10, 460, 'draft after date change')
assertEquals(currencyRateForDate(frontendRates, '2026-09-09'), 45.2, 'initial reconciliation date')
assertEquals(currencyRateForDate(frontendRates, '2026-09-20'), 46, 'current reconciliation ignores future October rate')
assertEquals(currencyRateForDate(frontendRates, '1999-12-31'), 0, 'no current-rate fallback for older dates')
const kyivDay = localDateKey(new Date('2026-09-09T21:30:00Z'))
assertEquals(kyivDay, '2026-09-10', 'Kyiv calendar day after UTC 21:00')
assertEquals(usdRateForDate(rates, kyivDay), 46, 'Kyiv midnight uses new rate')
