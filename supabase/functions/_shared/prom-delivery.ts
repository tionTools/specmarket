export type PromShippingSource = 'manual' | 'seller-api' | 'prom-promo' | 'none'

type ResolvePromShippingInput = {
  hasManualShipping: boolean
  manualShipping: number
  hasSellerDeliveryCost: boolean
  sellerDeliveryCost: number
  deliveryProvider: string
  isPromFreeDelivery: boolean
  orderAmount: number
}

export function resolvePromShipping(input: ResolvePromShippingInput): {
  shipping: number
  shippingSource: PromShippingSource
} {
  if (input.hasManualShipping) {
    return { shipping: input.manualShipping, shippingSource: 'manual' }
  }

  if (input.hasSellerDeliveryCost) {
    return { shipping: input.sellerDeliveryCost, shippingSource: 'seller-api' }
  }

  const deliveryProvider = input.deliveryProvider
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  const isRozetkaDelivery =
    deliveryProvider === 'rozetka_delivery' || deliveryProvider.includes('rozetka')
  const isNovaPoshta =
    deliveryProvider.includes('nova') || deliveryProvider.includes('нова')

  if (isRozetkaDelivery) {
    return {
      shipping: input.orderAmount >= 700 ? 30 : 10,
      // Keep the existing persisted source value for compatibility. The
      // amount is now selected by the Rozetka Delivery tariff, not promo flag.
      shippingSource: 'prom-promo',
    }
  }

  // Prom's Nova Poshta "Дешева доставка" promotion charges the seller
  // 10 UAH from 200 UAH and 30 UAH from 700 UAH; Prom pays the remainder.
  if (input.isPromFreeDelivery && isNovaPoshta && input.orderAmount >= 200) {
    return {
      shipping: input.orderAmount >= 700 ? 30 : 10,
      shippingSource: 'prom-promo',
    }
  }

  return { shipping: 0, shippingSource: 'none' }
}
