import {
  hasPromInstallmentPayment,
  isPromWebsiteOrder,
  promInstallmentCommissionAmount,
  promOrderLevelCommission,
  shouldUseSeparatedPromInstallmentAccounting,
} from './prom-order-financials.ts'

function assert(value: unknown, message = 'Assertion failed'): asserts value {
  if (!value) throw new Error(message)
}

Deno.test('All previous CRM orders stay on original calculation except 437654601', () => {
  const order = {
    source: 'mobile_catalog_app',
    payment_data: { rpay_parts: { commission: 3.7, commission_amount: 20.54 } },
  }
  assert(!isPromWebsiteOrder(order))
  assert(hasPromInstallmentPayment(order))
  assert(!hasPromInstallmentPayment({ payment_data: {} }))
  assert(promOrderLevelCommission(order) === 20.54)
  assert(promOrderLevelCommission(order, 0, false) === 0)
  assert(promInstallmentCommissionAmount(order) === 20.54)
  assert(!shouldUseSeparatedPromInstallmentAccounting('prom:437654600', true, {}))
  assert(shouldUseSeparatedPromInstallmentAccounting('prom:437654601', true, {}))
  assert(shouldUseSeparatedPromInstallmentAccounting('prom:437654602', false, {}))
  assert(shouldUseSeparatedPromInstallmentAccounting('prom:1', true, { promInstallmentAccountingV2: true }))
  assert(!shouldUseSeparatedPromInstallmentAccounting('prom:1', true, { isInstallmentPayment: true }))
})

Deno.test('New installment fee is acquiring, not royalty', () => {
  const order = {
    cpa_commission: { amount: 117.92 },
    payment_data: { rpay_parts: { commission: 3.4, commission_amount: 23.46 } },
  }
  assert(promOrderLevelCommission(order) === 23.46)
  assert(promOrderLevelCommission(order, 0, false) === 0)
  assert(promInstallmentCommissionAmount(order) === 23.46)
  assert(Math.abs(690 - 440 - 117.92 - 23.46 - 108.62) < 1e-9)
  assert(promInstallmentCommissionAmount({ payment_data: { rpay_parts: { commission: 3.7 } } }) === undefined)
  assert(promInstallmentCommissionAmount({ payment_data: { rpay_parts: { commission_amount: -2 } } }) === undefined)
})

Deno.test('Website ProSale remains an order-level commission', () => {
  const order = { prosale_commission: { type: 2, title: 'Комісія за замовлення з сайту', amount: 15 } }
  assert(isPromWebsiteOrder(order))
  assert(promOrderLevelCommission(order) === 15)
  assert(promOrderLevelCommission(order, 0, false) === 15)
  assert(promInstallmentCommissionAmount(order) === undefined)
  assert(!isPromWebsiteOrder({ source: 'mobile_catalog_app', ...order }))
})
