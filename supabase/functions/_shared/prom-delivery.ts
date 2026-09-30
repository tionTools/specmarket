export type PromShippingSource = 'manual' | 'seller-api' | 'prom-promo' | 'none'

type ResolvePromShippingInput = {
  hasManualShipping: boolean
  manualShipping: number
  hasSellerDeliveryCost: boolean
  sellerDeliveryCost: number
  deliveryProvider: string
  isPromFreeDelivery: boolean
  orderAmount: number
  promoShippingWaived?: boolean
}

type PromReturnShippingInput = {
  platform: string
  orderStatus: string
  delivery: Record<string, unknown>
}

const normalized = (value: unknown) =>
  String(value ?? '')
    .trim()
    .toLowerCase()

function currentShipmentRelation(delivery: Record<string, unknown>) {
  const currentTtn = normalized(delivery.ttn).replace(/\s/g, '')
  if (!currentTtn || !Array.isArray(delivery.shipmentHistory)) return ''
  for (const raw of delivery.shipmentHistory) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const row = raw as Record<string, unknown>
    if (normalized(row.ttn).replace(/\s/g, '') === currentTtn) return normalized(row.relation)
  }
  return ''
}

function hasReturnContext(delivery: Record<string, unknown>) {
  return (
    delivery.trackingReturnInProgress === true ||
    delivery.trackingReturnArrived === true ||
    normalized(delivery.trackingNormalizedStatus) === 'returning' ||
    currentShipmentRelation(delivery) === 'return'
  )
}

function cancelledOrderStatus(value: string) {
  return /скас|отмен|cancel/.test(normalized(value))
}

export function shouldWaivePromPromoShippingForUnclaimedReturn(
  input: PromReturnShippingInput,
): boolean {
  if (!['пром', 'prom'].includes(normalized(input.platform))) return false
  if (normalized(input.delivery.shippingSource) !== 'prom-promo') return false
  if (!hasReturnContext(input.delivery)) return false
  if (input.delivery.trackingBuyerReceived === true) return false
  if (input.delivery.trackingBuyerReceived === false) return true

  // Older tracked returns predate trackingBuyerReceived. A cancelled Prom order
  // with an active/arrived carrier return is the safe legacy signal for a
  // parcel that was refused at the pickup point rather than returned later.
  return cancelledOrderStatus(input.orderStatus)
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

  if (input.promoShippingWaived) {
    return { shipping: 0, shippingSource: 'prom-promo' }
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
