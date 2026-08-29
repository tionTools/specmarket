type Delivery = Record<string, unknown>

function text(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

export function paymentDetails(current: Delivery, incoming: Delivery = {}) {
  return {
    paymentAmount: typeof current.paymentAmount === 'number' ? current.paymentAmount : undefined,
    paymentMethod: text(incoming.paymentMethod) || text(current.paymentMethod),
    paymentStatus: text(incoming.paymentStatus) || text(current.paymentStatus),
  }
}
