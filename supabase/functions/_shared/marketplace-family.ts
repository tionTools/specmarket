import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { promoteLegacyPriceLink, type PriceCostSnapshot } from './price-cost.ts'

type RecordValue = Record<string, unknown>

const asRecord = (value: unknown): RecordValue =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {}
const text = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
const pick = (record: RecordValue, ...keys: string[]) =>
  keys.map((key) => record[key]).find((value) => value !== undefined && value !== null && value !== '')
const unique = (values: string[]) => [...new Set(values.filter(Boolean))]

export type MarketplaceFamilyIdentity = {
  familyKey: string
  legacyKeys: string[]
}

export function epicentrFamilyIdentity(item: RecordValue): MarketplaceFamilyIdentity {
  const product = asRecord(item.product)
  const modelId = text(pick(product, 'modelId', 'model_id'))
  const productIds = unique([
    text(pick(item, 'productId', 'product_id')),
    text(pick(product, 'id', 'productId', 'product_id')),
  ])
  const offerId = text(pick(item, 'offerId', 'offer_id'))
  return {
    familyKey: modelId ? `model:${modelId}` : '',
    legacyKeys: unique([
      ...productIds.map((productId) => `product:${productId}`),
      offerId ? `offer:${offerId}` : '',
    ]),
  }
}

export function promLegacyProductKeys(item: RecordValue, productValue?: unknown) {
  const product = asRecord(productValue)
  const sku = text(pick(item, 'sku')) || text(pick(product, 'sku'))
  const externalId =
    text(pick(item, 'external_id', 'externalId')) ||
    text(pick(product, 'external_id', 'externalId'))
  const productIds = unique([
    text(pick(item, 'product_id', 'productId')),
    text(pick(product, 'id', 'product_id', 'productId')),
  ])
  return unique([
    sku ? `sku:${sku}` : '',
    externalId ? `external:${externalId}` : '',
    ...productIds.map((productId) => `product:${productId}`),
  ])
}

export function promVariationFamilyKey(productValue: unknown) {
  const product = asRecord(productValue)
  const variationGroupId = text(pick(product, 'variation_group_id', 'variationGroupId'))
  return variationGroupId ? `variation_group:${variationGroupId}` : ''
}

export async function loadMarketplaceFamilyMappings(
  admin: SupabaseClient,
  platform: string,
): Promise<Map<string, string>> {
  const { data, error } = await admin
    .from('crm_marketplace_product_families')
    .select('marketplace_product_key, family_key')
    .eq('platform', platform)
  if (error) throw error

  return new Map(
    (data ?? [])
      .map((row) => [text(row.marketplace_product_key), text(row.family_key)] as const)
      .filter(([key, familyKey]) => Boolean(key && familyKey)),
  )
}

export function mappedFamilyKey(mappings: Map<string, string>, legacyKeys: string[]) {
  const families = unique(legacyKeys.map((key) => mappings.get(key) ?? ''))
  return families.length === 1 ? families[0] : ''
}

export function mappedLegacyKeys(
  mappings: Map<string, string>,
  familyKey: string,
  extraLegacyKeys: string[] = [],
) {
  const keys = [...extraLegacyKeys]
  for (const [legacyKey, mappedFamily] of mappings) {
    if (mappedFamily === familyKey) keys.push(legacyKey)
  }
  return unique(keys)
}

export async function rememberMarketplaceFamily(
  admin: SupabaseClient,
  platform: string,
  familyKey: string,
  legacyKeys: string[],
  mappings: Map<string, string>,
): Promise<boolean> {
  if (!familyKey) return false
  const keys = unique(legacyKeys).filter((key) => key !== familyKey)
  if (!keys.length) return true
  if (keys.some((key) => mappings.has(key) && mappings.get(key) !== familyKey)) return false

  const missingKeys = keys.filter((key) => !mappings.has(key))
  if (missingKeys.length) {
    const { error } = await admin.from('crm_marketplace_product_families').upsert(
      missingKeys.map((marketplaceProductKey) => ({
        platform,
        marketplace_product_key: marketplaceProductKey,
        family_key: familyKey,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: 'platform,marketplace_product_key', ignoreDuplicates: true },
    )
    if (error) throw error
  }

  const { data: stored, error: storedError } = await admin
    .from('crm_marketplace_product_families')
    .select('marketplace_product_key, family_key')
    .eq('platform', platform)
    .in('marketplace_product_key', keys)
  if (storedError) throw storedError

  const storedMappings = new Map(
    (stored ?? []).map((row) => [
      text(row.marketplace_product_key),
      text(row.family_key),
    ] as const),
  )
  if (keys.some((key) => storedMappings.get(key) !== familyKey)) return false

  for (const key of keys) mappings.set(key, familyKey)
  return true
}

export function familyPriceLinkConflict(
  snapshots: Map<string, PriceCostSnapshot>,
  keys: string[],
) {
  const priceItemIds = unique(
    keys
      .map((key) => snapshots.get(key)?.priceItemId ?? '')
      .filter(Boolean),
  )
  return priceItemIds.length > 1
}

export async function promoteFamilyPriceLink(
  admin: SupabaseClient,
  platform: string,
  familyKey: string,
  legacyKeys: string[],
  snapshots: Map<string, PriceCostSnapshot>,
  productTitle?: string,
  size?: string,
): Promise<{ snapshot?: PriceCostSnapshot; conflict: boolean }> {
  if (!familyKey) return { conflict: false }

  const candidateKeys = unique([familyKey, ...legacyKeys])
  if (familyPriceLinkConflict(snapshots, candidateKeys)) return { conflict: true }

  const snapshot = candidateKeys
    .map((key) => snapshots.get(key))
    .find((value): value is PriceCostSnapshot => Boolean(value))
  if (!snapshot) return { conflict: false }
  if (snapshots.has(familyKey)) return { snapshot, conflict: false }

  const legacyKey =
    candidateKeys.find((key) => snapshots.get(key)?.priceItemId === snapshot.priceItemId) ?? ''
  const promoted = await promoteLegacyPriceLink(
    admin,
    platform,
    legacyKey,
    familyKey,
    snapshot,
    productTitle,
    size,
  )
  if (!promoted) {
    const { data, error } = await admin
      .from('crm_product_price_links')
      .select('price_item_id')
      .eq('platform', platform)
      .eq('marketplace_product_key', familyKey)
      .maybeSingle()
    if (error) throw error
    if (text(data?.price_item_id) !== snapshot.priceItemId) return { conflict: true }
  }

  snapshots.set(familyKey, snapshot)
  return { snapshot, conflict: false }
}
