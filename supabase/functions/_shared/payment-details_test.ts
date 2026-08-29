import { paymentDetails } from './payment-details.ts'

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

for (const marketplace of ['Prom', 'Kasta', 'Epicentr']) {
  const current = { paymentAmount: 150, paymentMethod: 'card', paymentStatus: 'paid' }
  const preserved = paymentDetails(current)
  assert(
    preserved.paymentAmount === 150 && preserved.paymentMethod === 'card' && preserved.paymentStatus === 'paid',
    `${marketplace} cleared known payment details`,
  )
  const updated = paymentDetails(current, { paymentMethod: 'cash', paymentStatus: 'confirmed' })
  assert(
    updated.paymentAmount === 150 && updated.paymentMethod === 'cash' && updated.paymentStatus === 'confirmed',
    `${marketplace} ignored confirmed payment details`,
  )
}
