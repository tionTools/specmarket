import type { Order } from './types'

export function isEpicentrShippingUnconfirmed(order: Pick<Order, 'platform' | 'delivery'>) {
  return (
    order.platform === 'Эпицентр' &&
    order.delivery.shippingSource !== 'manual' &&
    order.delivery.shippingSource !== 'seller-api'
  )
}
