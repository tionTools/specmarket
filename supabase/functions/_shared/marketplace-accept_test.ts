import {
  epicentrConfirmationStatus,
  epicentrOrderStatus,
  isAcceptedMarketplaceStatus,
  isNewMarketplaceStatus,
  normalizeExternalIds,
} from './marketplace-accept.ts'

function assert(value: unknown, message = 'Assertion failed'): asserts value {
  if (!value) throw new Error(message)
}

Deno.test('marketplace acceptance validates IDs and status classes', () => {
  assert(
    JSON.stringify(normalizeExternalIds(['epicentr:12', 12, '13'], 'epicentr')) ===
      JSON.stringify(['12', '13']),
  )
  let rejected = false
  try {
    normalizeExternalIds(['0'], 'kasta')
  } catch {
    rejected = true
  }
  assert(rejected)
  assert(isNewMarketplaceStatus('Created'))
  assert(isAcceptedMarketplaceStatus('Принято'))
  assert(isAcceptedMarketplaceStatus('Підтверджено'))
  assert(isAcceptedMarketplaceStatus('confirmed_by_seller'))
})

Deno.test('Epicentr selects only an API-allowed seller confirmation', () => {
  assert(
    epicentrConfirmationStatus({
      data: [{ code: 'cancelled' }, { code: 'confirmed_by_seller' }],
    }) === 'confirmed_by_seller',
  )
  assert(epicentrConfirmationStatus(['sent']) === undefined)
})

Deno.test('Epicentr verification extracts the actual marketplace status after POST', () => {
  assert(epicentrOrderStatus({ data: { order: { statusCode: 'confirmed_by_seller' } } }) ===
    'confirmed_by_seller')
  assert(epicentrOrderStatus({ data: { status: { code: 'confirmed' } } }) === 'confirmed')
  assert(!isAcceptedMarketplaceStatus(epicentrOrderStatus({ data: { order: { statusCode: 'new' } } })))
})
