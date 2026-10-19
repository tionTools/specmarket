export function epicentrShipping(input: {
  existingShipping?: number | string | null
  existingSource?: string | null
  deliveryPrice?: number | null
  previousDeliveryPrice?: number | null
  isFree?: boolean | null
  previousIsFree?: boolean | null
}) {
  return {
    shipping: Number(input.existingShipping ?? 0),
    shippingSource: input.existingSource ?? (input.existingShipping == null ? 'unconfirmed' : undefined),
    deliveryPrice: input.deliveryPrice ?? input.previousDeliveryPrice,
    isFree: input.isFree ?? input.previousIsFree,
  }
}
