import { isPromWebsiteOrder, promOrderLevelCommission } from './prom-order-financials.ts'

function assert(value: unknown, message = 'Assertion failed'): asserts value {
  if (!value) throw new Error(message)
}

Deno.test('Prom mobile app installment commission uses amount, not percentage', () => {
  const order = {
    source: 'mobile_catalog_app',
    cpa_commission: { amount: 98.46 },
    payment_data: {
      rpay_parts: {
        commission: 3.70,
        commission_amount: 20.54,
      },
    },
  }

  assert(!isPromWebsiteOrder(order))
  assert(promOrderLevelCommission(order) === 20.54)
  assert(Math.abs(98.46 + promOrderLevelCommission(order) - 119.00) < 1e-9)
})

Deno.test('Prom website marker remains separate from order-level commission amount', () => {
  const websiteOrder = {
    prosale_commission: {
      type: 2,
      title: 'Комісія за замовлення з сайту',
      amount: 15,
    },
  }

  assert(isPromWebsiteOrder(websiteOrder))
  assert(promOrderLevelCommission(websiteOrder) === 15)

  const mobileOrderWithMarker = {
    source: 'mobile_catalog_app',
    prosale_commission: websiteOrder.prosale_commission,
  }
  assert(!isPromWebsiteOrder(mobileOrderWithMarker))
  assert(promOrderLevelCommission(mobileOrderWithMarker) === 15)
})
