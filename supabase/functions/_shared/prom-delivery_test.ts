import { resolvePromShipping, shouldWaivePromPromoShippingForUnclaimedReturn } from './prom-delivery.ts'

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


const waivedPromo = resolvePromShipping({
  hasManualShipping: false,
  manualShipping: 0,
  hasSellerDeliveryCost: false,
  sellerDeliveryCost: 0,
  deliveryProvider: 'Нова Пошта',
  isPromFreeDelivery: true,
  orderAmount: 1479,
  promoShippingWaived: true,
})
assert(
  waivedPromo.shipping === 0 && waivedPromo.shippingSource === 'prom-promo',
  'Unclaimed Prom promo return must waive the fallback seller delivery charge',
)

const waivedManual = resolvePromShipping({
  hasManualShipping: true,
  manualShipping: 44,
  hasSellerDeliveryCost: false,
  sellerDeliveryCost: 0,
  deliveryProvider: 'Нова Пошта',
  isPromFreeDelivery: true,
  orderAmount: 1479,
  promoShippingWaived: true,
})
assert(
  waivedManual.shipping === 44 && waivedManual.shippingSource === 'manual',
  'Promo waiver must not overwrite a manual shipping amount',
)

const waivedSellerApi = resolvePromShipping({
  hasManualShipping: false,
  manualShipping: 0,
  hasSellerDeliveryCost: true,
  sellerDeliveryCost: 17,
  deliveryProvider: 'Нова Пошта',
  isPromFreeDelivery: true,
  orderAmount: 1479,
  promoShippingWaived: true,
})
assert(
  waivedSellerApi.shipping === 17 && waivedSellerApi.shippingSource === 'seller-api',
  'Promo waiver must not overwrite an explicit seller delivery cost from Prom',
)

const unclaimedReturn = {
  shippingSource: 'prom-promo',
  trackingReturnArrived: true,
  trackingBuyerReceived: false,
}
assert(
  shouldWaivePromPromoShippingForUnclaimedReturn({
    platform: 'Пром',
    orderStatus: 'Скасовано',
    delivery: unclaimedReturn,
  }),
  'Prom promo delivery must be waived when the buyer never received the parcel',
)

assert(
  !shouldWaivePromPromoShippingForUnclaimedReturn({
    platform: 'Пром',
    orderStatus: 'Скасовано',
    delivery: { ...unclaimedReturn, trackingBuyerReceived: true },
  }),
  'Prom promo delivery must remain charged when the buyer received the parcel before returning it',
)

assert(
  !shouldWaivePromPromoShippingForUnclaimedReturn({
    platform: 'Пром',
    orderStatus: 'Скасовано',
    delivery: { ...unclaimedReturn, shippingSource: 'manual' },
  }),
  'Return tracking must not zero a manually entered shipping cost',
)

assert(
  shouldWaivePromPromoShippingForUnclaimedReturn({
    platform: 'Пром',
    orderStatus: 'Скасовано',
    delivery: {
      shippingSource: 'prom-promo',
      trackingReturnArrived: true,
    },
  }),
  'Legacy cancelled Prom return must waive promo shipping when receipt history predates the buyer-received flag',
)

assert(
  !shouldWaivePromPromoShippingForUnclaimedReturn({
    platform: 'Пром',
    orderStatus: 'Виконано',
    delivery: {
      shippingSource: 'prom-promo',
      trackingReturnArrived: true,
    },
  }),
  'Legacy completed Prom return must keep promo shipping when buyer receipt history is unknown',
)
