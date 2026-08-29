import { reapplyRegistryPreview } from './registry-preview'

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

const order = { paymentAmount: 0, acquiring: 0 }
reapplyRegistryPreview(true, [{ paymentAmount: 150, acquiring: 3 }], ([preview]) => {
  order.paymentAmount = preview!.paymentAmount
  order.acquiring = preview!.acquiring
})
assert(
  order.paymentAmount === 150 && order.acquiring === 3,
  'realtime refresh must restore an open registry preview',
)

reapplyRegistryPreview(false, [{ paymentAmount: 0, acquiring: 0 }], ([preview]) => {
  order.paymentAmount = preview!.paymentAmount
  order.acquiring = preview!.acquiring
})
assert(
  order.paymentAmount === 150 && order.acquiring === 3,
  'closed registry must not apply a preview',
)
