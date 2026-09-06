export type PromShippingSource = 'manual' | 'seller-api' | 'prom-promo' | 'none'

type ResolvePromShippingInput = {
  hasManualShipping: boolean
  manualShipping: number
  hasSellerDeliveryCost: boolean
  sellerDeliveryCost: number
  deliveryProvider: string
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

  if (input.deliveryProvider.trim().toLowerCase() === 'rozetka_delivery') {
    return {
      shipping: input.orderAmount >= 700 ? 30 : 10,
      // Keep the existing persisted source value for compatibility. The
      // amount is now selected by the Rozetka Delivery tariff, not promo flag.
      shippingSource: 'prom-promo',
    }
  }

  return { shipping: 0, shippingSource: 'none' }
}
