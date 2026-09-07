import type { Order, OrderProduct } from './types'

export const getRemainingQuantity = (product: OrderProduct) =>
  Math.max(0, product.quantity - (product.returnedQuantity ?? 0))

export const getNetOrderAmount = (order: Order) =>
  order.products.reduce((sum, product) => sum + product.price * getRemainingQuantity(product), 0)

export const getNetOrderCost = (order: Order) =>
  order.products.reduce((sum, product) => sum + product.cost * getRemainingQuantity(product), 0)

export const getProductRoyalty = (order: Order, product: OrderProduct) =>
  product.royaltyAmount ??
  product.price *
    product.quantity *
    ((product.royaltyPercent ?? (order.platform === 'Каста' ? 22 : 0)) / 100)

export const getNetRoyalty = (order: Order) =>
  order.products.reduce((sum, product) => {
    const remainingQuantity = getRemainingQuantity(product)
    if (remainingQuantity === product.quantity) return sum + getProductRoyalty(order, product)
    if (product.quantity <= 0) return sum
    if (product.royaltyAmount !== undefined)
      return sum + product.royaltyAmount * (remainingQuantity / product.quantity)
    const percent = product.royaltyPercent ?? (order.platform === 'Каста' ? 22 : 0)
    return sum + product.price * remainingQuantity * (percent / 100)
  }, 0)
