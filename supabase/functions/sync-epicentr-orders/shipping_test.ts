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
  assert(seller.shippingSource === undefined, 'legacy expense provenance must not be changed')
  assert(manual.shipping === 0 && manual.shippingSource === 'manual', 'manual correction changed')
  assert(epicentrShipping({ existingShipping: 12, existingSource: 'seller-api' }).shippingSource === 'seller-api', 'confirmed source changed')
})

Deno.test('partial API response retains previously displayed delivery facts', () => {
  const result = epicentrShipping({ existingShipping: 41.9, previousDeliveryPrice: 41.9, previousIsFree: true })
  assert(result.shipping === 41.9 && result.deliveryPrice === 41.9 && result.isFree === true, 'partial response erased shipping facts')
})

Deno.test('updated API delivery price never changes existing seller expense', () => {
  const result = epicentrShipping({ existingShipping: 41.9, deliveryPrice: 50, isFree: false })
  assert(result.shipping === 41.9 && result.deliveryPrice === 50, 'delivery price was counted as seller expense')
})
