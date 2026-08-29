import { marketplaceMatchesCarrierDelivery, marketplaceMustKeepCarrierDelivery, marketplaceReplacementHistory } from './delivery-history.ts'

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

const redirectedDelivery = {
  carrier: 'Новая почта',
  ttn: 'B',
  city: 'Carrier city',
  address: 'Carrier address',
  shipmentHistory: [
    { ttn: 'A', relation: 'original', city: 'Київ', address: 'Відділення 1' },
    { ttn: 'B', relation: 'redirect', relatedTtn: 'A', city: 'Одеса', address: 'Відділення 2' },
  ],
}

Deno.test('Prom, Kasta and Epicentr keep carrier-active TTN for a known redirect chain', () => {
  for (const platform of ['Prom', 'Kasta', 'Epicentr']) {
    assert(
      marketplaceMustKeepCarrierDelivery(redirectedDelivery, 'Новая почта', 'A'),
      `${platform} rolled back the carrier-active TTN`,
    )
  }
})

Deno.test('a marketplace TTN outside the known chain is not treated as a redirect', () => {
  assert(
    !marketplaceMatchesCarrierDelivery(redirectedDelivery, 'Новая почта', 'C'),
    'unknown marketplace TTN was treated as a redirect',
  )
})

Deno.test('a new marketplace TTN keeps the previous chain and destination snapshots', () => {
  const history = marketplaceReplacementHistory(redirectedDelivery, 'Новая почта', 'C', {
    city: 'Львів', address: 'Відділення 3',
  })
  const shipments = history.shipmentHistory as Array<Record<string, unknown>>
  assert(shipments.length === 3, 'previous shipment history was lost')
  assert(shipments[0]?.city === 'Київ' && shipments[1]?.city === 'Одеса', 'existing destination snapshots were lost')
  assert(
    shipments.at(-1)?.ttn === 'C' && shipments.at(-1)?.relation === 'unknown' && shipments.at(-1)?.city === 'Львів',
    'new TTN destination was not recorded',
  )
})

Deno.test('a legacy marketplace order receives complete original and unknown snapshots', () => {
  const history = marketplaceReplacementHistory({
    carrier: 'Новая почта', ttn: 'A', city: 'Київ', address: 'Відділення 1',
  }, 'Новая почта', 'C', { city: 'Львів', address: 'Відділення 2' })
  const shipments = history.shipmentHistory as Array<Record<string, unknown>>
  assert(shipments.length === 2, 'legacy delivery snapshots were not created')
  assert(shipments[0]?.city === 'Київ' && shipments[1]?.city === 'Львів', 'snapshot destinations are incomplete')
  assert((history.addressHistory as string[]).includes('Київ, Відділення 1'), 'old address was not retained')
})
