import { epicentrCancellationTtn } from './cancellation.ts'

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

Deno.test('Epicentr cancellation retires an unhanded label but keeps its history', () => {
  const result = epicentrCancellationTtn('canceled', '', {
    ttn: 'OLD',
    printedAt: '2026-10-19',
    trackingNormalizedStatus: 'created',
    ttnHistory: ['EARLIER'],
  })
  assert(result.retired && result.ttn === '', 'created label must not remain active')
  assert(result.ttnHistory?.join(',') === 'EARLIER,OLD', 'old label must stay in history')
  assert(
    epicentrCancellationTtn('canceled', '', { ttn: 'DELETED', trackingNormalizedStatus: 'deleted' })
      .retired,
    'carrier-deleted label must be retired',
  )
  assert(
    epicentrCancellationTtn('canceled', '', { ttn: '', ttnHistory: result.ttnHistory }).ttn === '',
    'retry must not restore label',
  )
})

Deno.test('Epicentr cancellation keeps a label after confirmed carrier movement', () => {
  for (const status of [
    'accepted',
    'in_transit',
    'forwarding',
    'ready_for_pickup',
    'delivered',
    'returning',
    'returned',
  ]) {
    const result = epicentrCancellationTtn('canceled', '', {
      ttn: 'SHIPPED',
      trackingNormalizedStatus: status,
    })
    assert(!result.retired && result.ttn === 'SHIPPED', status)
  }
})

Deno.test('unknown carrier status keeps tracking available without proving handover', () => {
  const unknown = epicentrCancellationTtn('canceled', '', {
    ttn: 'OLD',
    printedAt: '2026-10-19',
    trackingNormalizedStatus: 'unknown',
  })
  assert(
    !unknown.retired && unknown.ttn === 'OLD',
    'unknown status must keep carrier tracking available',
  )
  const active = epicentrCancellationTtn('canceled', 'CURRENT', {
    ttn: 'OLD',
    trackingNormalizedStatus: 'created',
  })
  assert(!active.retired && active.ttn === 'CURRENT', 'API label must not be retired')
})
