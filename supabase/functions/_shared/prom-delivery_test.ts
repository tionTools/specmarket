import { resolvePromShipping } from './prom-delivery.ts'

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

function rozDelivery(orderAmount: number) {
  return resolvePromShipping({
    hasManualShipping: false,
    manualShipping: 0,
    hasSellerDeliveryCost: false,
    sellerDeliveryCost: 0,
    deliveryProvider: 'rozetka_delivery',
    isPromFreeDelivery: false,
    orderAmount,
  })
}

for (const orderAmount of [105, 147, 240, 300, 699.99]) {
  const result = rozDelivery(orderAmount)
  assert(
    result.shipping === 10 && result.shippingSource === 'prom-promo',
    `Rozetka Delivery order ${orderAmount} UAH must cost seller 10 UAH`,
  )
}

for (const orderAmount of [700, 1512]) {
  const result = rozDelivery(orderAmount)
  assert(
    result.shipping === 30 && result.shippingSource === 'prom-promo',
    `Rozetka Delivery order ${orderAmount} UAH must cost seller 30 UAH`,
  )
}

const manual = resolvePromShipping({
  hasManualShipping: true,
  manualShipping: 44,
  hasSellerDeliveryCost: true,
  sellerDeliveryCost: 17,
  deliveryProvider: 'rozetka_delivery',
  isPromFreeDelivery: true,
  orderAmount: 800,
})
assert(
  manual.shipping === 44 && manual.shippingSource === 'manual',
  'Manual Prom shipping must win over API and Rozetka tariff values',
)

const sellerApi = resolvePromShipping({
  hasManualShipping: false,
  manualShipping: 0,
  hasSellerDeliveryCost: true,
  sellerDeliveryCost: 17,
  deliveryProvider: 'rozetka_delivery',
  isPromFreeDelivery: true,
  orderAmount: 800,
})
assert(
  sellerApi.shipping === 17 && sellerApi.shippingSource === 'seller-api',
  'Explicit seller delivery cost from Prom API must win over Rozetka tariff fallback',
)

const otherProvider = resolvePromShipping({
  hasManualShipping: false,
  manualShipping: 0,
  hasSellerDeliveryCost: false,
  sellerDeliveryCost: 0,
  deliveryProvider: 'nova_poshta',
  isPromFreeDelivery: false,
  orderAmount: 240,
})
assert(
  otherProvider.shipping === 0 && otherProvider.shippingSource === 'none',
  'Rozetka tariff fallback must not affect other delivery providers',
)

for (const [orderAmount, expected] of [
  [200, 10],
  [699.99, 10],
  [700, 30],
  [1020, 30],
] as const) {
  const result = resolvePromShipping({
    hasManualShipping: false,
    manualShipping: 0,
    hasSellerDeliveryCost: false,
    sellerDeliveryCost: 0,
    deliveryProvider: 'Нова Пошта',
    isPromFreeDelivery: true,
    orderAmount,
  })
  assert(
    result.shipping === expected && result.shippingSource === 'prom-promo',
    `Prom Nova Poshta promo order ${orderAmount} UAH must cost seller ${expected} UAH`,
  )
}

const novaBelowMinimum = resolvePromShipping({
  hasManualShipping: false,
  manualShipping: 0,
  hasSellerDeliveryCost: false,
  sellerDeliveryCost: 0,
  deliveryProvider: 'Нова Пошта',
  isPromFreeDelivery: true,
  orderAmount: 199.99,
})
assert(
  novaBelowMinimum.shipping === 0 && novaBelowMinimum.shippingSource === 'none',
  'Prom Nova Poshta promo must not charge seller below the 200 UAH promotion minimum',
)
