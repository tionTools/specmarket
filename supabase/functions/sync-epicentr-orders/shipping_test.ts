import { epicentrShipping } from './shipping.ts'

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message)
}

Deno.test('buyer-paid API delivery price does not become seller expense', () => {
  const result = epicentrShipping({ deliveryPrice: 50, isFree: false })
  assert(result.shipping === 0 && result.shippingSource === 'unconfirmed', 'new expense must remain unconfirmed')
  assert(result.deliveryPrice === 50 && result.isFree === false, 'buyer delivery metadata lost')
  const confirmed = epicentrShipping({ existingShipping: 0, existingSource: 'manual', deliveryPrice: 50, isFree: false })
  assert(Math.round((105 - 61.02 - 13.65 - 1.365 - confirmed.shipping) * 100) / 100 === 28.97, 'manual zero expense must yield 28.97')
})

Deno.test('confirmed historical and manual seller expenses survive sync', () => {
  const seller = epicentrShipping({ existingShipping: 41.9, deliveryPrice: 41.9, isFree: true })
  const manual = epicentrShipping({ existingShipping: 0, existingSource: 'manual', deliveryPrice: 50 })
  assert(seller.shipping === 41.9 && seller.deliveryPrice === 41.9 && seller.isFree === true, 'historical seller expense changed')
  assert(seller.shippingSource === 'seller-api', 'free delivery must confirm seller expense')
  assert(manual.shipping === 0 && manual.shippingSource === 'manual', 'manual correction changed')
  assert(epicentrShipping({ existingShipping: 12, existingSource: 'seller-api' }).shippingSource === 'seller-api', 'confirmed source changed')
})

Deno.test('free buyer delivery fills new and previously unconfirmed seller expenses', () => {
  for (const existingShipping of [undefined, 0]) {
    const result = epicentrShipping({ existingShipping, existingSource: 'unconfirmed', deliveryPrice: 38.45, isFree: true })
    assert(result.shipping === 38.45 && result.shippingSource === 'seller-api', 'order 58676980 delivery expense missing')
  }
  const updated = epicentrShipping({ existingShipping: 38.45, existingSource: 'seller-api', deliveryPrice: 42, isFree: true })
  assert(updated.shipping === 42, 'seller expense must follow API price')
  const cached = epicentrShipping({ existingShipping: 0, existingSource: 'unconfirmed', previousDeliveryPrice: 38.45, previousIsFree: true })
  assert(cached.shipping === 38.45, 'partial sync must use saved delivery facts')
})

Deno.test('free delivery preserves manual expenses and rejects invalid prices', () => {
  for (const existingShipping of [0, 12]) {
    const result = epicentrShipping({ existingShipping, existingSource: 'manual', deliveryPrice: 38.45, isFree: true })
    assert(result.shipping === existingShipping && result.shippingSource === 'manual', 'manual expense overwritten')
  }
  for (const deliveryPrice of [undefined, -1, NaN, Infinity]) {
    const result = epicentrShipping({ deliveryPrice, isFree: true })
    assert(result.shipping === 0 && result.shippingSource === 'unconfirmed', 'invalid price confirmed')
  }
  const zero = epicentrShipping({ deliveryPrice: 0, isFree: true })
  assert(zero.shipping === 0 && zero.shippingSource === 'seller-api', 'explicit zero price lost')
  const unknown = epicentrShipping({ deliveryPrice: 38.45 })
  assert(unknown.shipping === 0 && unknown.shippingSource === 'unconfirmed', 'unknown payer charged')
})

Deno.test('partial API response retains previously displayed delivery facts', () => {
  const result = epicentrShipping({ existingShipping: 41.9, previousDeliveryPrice: 41.9, previousIsFree: true })
  assert(result.shipping === 41.9 && result.deliveryPrice === 41.9 && result.isFree === true, 'partial response erased shipping facts')
})

Deno.test('updated API delivery price never changes existing seller expense', () => {
  const result = epicentrShipping({ existingShipping: 41.9, deliveryPrice: 50, isFree: false })
  assert(result.shipping === 41.9 && result.deliveryPrice === 50, 'delivery price was counted as seller expense')
})
