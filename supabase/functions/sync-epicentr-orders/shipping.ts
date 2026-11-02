export function epicentrShipping(input: {
  existingShipping?: number | string | null
  existingSource?: string | null
  deliveryPrice?: number | null
  previousDeliveryPrice?: number | null
  isFree?: boolean | null
  previousIsFree?: boolean | null
}) {
  const deliveryPrice = input.deliveryPrice ?? input.previousDeliveryPrice
  const isFree = input.isFree ?? input.previousIsFree
  const sellerPays = input.existingSource !== 'manual' && isFree === true &&
    typeof deliveryPrice === 'number' && Number.isFinite(deliveryPrice) && deliveryPrice >= 0
  return {
    shipping: sellerPays ? deliveryPrice : Number(input.existingShipping ?? 0),
    shippingSource: sellerPays ? 'seller-api' : input.existingSource ?? (input.existingShipping == null ? 'unconfirmed' : undefined),
    deliveryPrice,
    isFree,
  }
}
