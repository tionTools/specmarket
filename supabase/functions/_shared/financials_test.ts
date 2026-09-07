import {
  getNetOrderAmount,
  getNetOrderCost,
  getNetRoyalty,
  getRemainingQuantity,
} from '../../../src/features/orders/financials.ts'
import type { Order } from '../../../src/features/orders/types.ts'

function assert(value: unknown, message = 'Assertion failed'): asserts value {
  if (!value) throw new Error(message)
}

const order = (): Order => ({
  id: 'S5TSAE5',
  date: '01.09.2026',
  customer: '',
  phone: '',
  platform: 'Каста',
  status: 'Відмова від отримання',
  products: [
    {
      id: '1',
      name: '',
      size: '',
      quantity: 1,
      price: 676,
      cost: 429,
      royaltyAmount: 101.4,
    },
  ],
  shipping: 0,
  acquiring: 0,
  delivery: {
    carrier: 'Новая почта',
    ttn: '2040',
    recipient: '',
    recipientPhone: '',
    city: '',
    address: '',
    status: '',
    payer: '',
    trackingNormalizedStatus: 'returning',
  },
})

Deno.test('marketplace return status does not change financials before accepted CRM return', () => {
  const value = order()
  assert(getRemainingQuantity(value.products[0]!) === 1)
  assert(getNetOrderAmount(value) === 676)
  assert(getNetOrderCost(value) === 429)
  assert(getNetRoyalty(value) === 101.4)
})

Deno.test('accepted full and partial returns proportionally reduce sale cost and royalty', () => {
  const full = order()
  full.products[0]!.returnedQuantity = 1
  assert(getNetOrderAmount(full) === 0)
  assert(getNetOrderCost(full) === 0)
  assert(getNetRoyalty(full) === 0)

  const partial = order()
  partial.products[0]!.quantity = 2
  partial.products[0]!.price = 338
  partial.products[0]!.cost = 214.5
  partial.products[0]!.royaltyAmount = 101.4
  partial.products[0]!.returnedQuantity = 1
  assert(getRemainingQuantity(partial.products[0]!) === 1)
  assert(getNetOrderAmount(partial) === 338)
  assert(getNetOrderCost(partial) === 214.5)
  assert(getNetRoyalty(partial) === 50.7)
})
