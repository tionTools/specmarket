import { resolvedOrderItemCost, type PriceCostSnapshot } from './price-cost.ts'
import {
  epicentrFamilyIdentity,
  familyPriceLinkConflict,
  mappedFamilyKey,
  mappedLegacyKeys,
  promLegacyProductKeys,
  promVariationFamilyKey,
} from './marketplace-family.ts'

function assertEquals(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`)
  }
}

const epicentr46 = epicentrFamilyIdentity({
  offerId: '3e7c6649-106a-48fc-8d47-b58104919f7e',
  productId: '29688740',
  product: { id: 29688740, modelId: 8869122 },
})
const epicentr44 = epicentrFamilyIdentity({
  offerId: 'a27f969a-3c31-433c-814b-f1961a6167d9',
  productId: '29688518',
  product: { id: 29688518, modelId: 8869122 },
})
assertEquals(epicentr46.familyKey, 'model:8869122', 'Epicentr size 46 family key')
assertEquals(epicentr44.familyKey, 'model:8869122', 'Epicentr size 44 family key')
assertEquals(epicentr46.legacyKeys[0], 'product:29688740', 'Epicentr legacy product key')

assertEquals(
  promVariationFamilyKey({ id: 2999555219, variation_group_id: 653957377 }),
  'variation_group:653957377',
  'Prom variation family key',
)
assertEquals(
  promLegacyProductKeys(
    { sku: '712-24-M', product_id: 2999555219 },
    { id: 2999555219, variation_group_id: 653957377 },
  ),
  ['sku:712-24-M', 'product:2999555219'],
  'Prom legacy keys',
)

const mappings = new Map([
  ['sku:712-24-M', 'variation_group:653957377'],
  ['sku:712-24', 'variation_group:653957377'],
])
assertEquals(
  mappedFamilyKey(mappings, ['sku:712-24-M']),
  'variation_group:653957377',
  'Mapped Prom family',
)
assertEquals(
  mappedLegacyKeys(mappings, 'variation_group:653957377').sort(),
  ['sku:712-24', 'sku:712-24-M'].sort(),
  'Mapped Prom siblings',
)
assertEquals(
  mappedFamilyKey(
    new Map([
      ['sku:a', 'variation_group:1'],
      ['product:2', 'variation_group:2'],
    ]),
    ['sku:a', 'product:2'],
  ),
  '',
  'Conflicting mappings must not pick a family',
)

const priceA: PriceCostSnapshot = { priceItemId: 'price-a', cost: 100, costUsd: 0 }
const priceB: PriceCostSnapshot = { priceItemId: 'price-b', cost: 100, costUsd: 0 }
assertEquals(
  familyPriceLinkConflict(
    new Map([
      ['sku:a', priceA],
      ['sku:b', priceA],
    ]),
    ['sku:a', 'sku:b'],
  ),
  false,
  'Same price item is not a conflict',
)
assertEquals(
  familyPriceLinkConflict(
    new Map([
      ['sku:a', priceA],
      ['sku:b', priceB],
    ]),
    ['sku:a', 'sku:b'],
  ),
  true,
  'Different price items must conflict',
)

const preserved = resolvedOrderItemCost(
  {
    cost: 429,
    cost_usd: 0,
    cost_manual: false,
    price_item_id: null,
  },
  {
    priceItemId: '0e9b6a46-2cf8-4ed7-9683-28682c7278a2',
    cost: 500,
    costUsd: 0,
  },
)
assertEquals(preserved.cost, 429, 'Existing nonzero cost must not be overwritten')
assertEquals(
  preserved.priceItemId,
  '0e9b6a46-2cf8-4ed7-9683-28682c7278a2',
  'Canonical price link may fill price_item_id without overwriting nonzero cost',
)
