import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export type PriceCostSnapshot = {
  priceItemId: string
  cost: number
  costUsd: number
}

export type PriceCostMatch = {
  snapshot: PriceCostSnapshot
  matchedKey: string
}

type RecordValue = Record<string, unknown>

const text = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : ''
const number = (value: unknown) => Number(text(value).replace(',', '.')) || 0

export async function loadPlatformPriceCostSnapshots(
  admin: SupabaseClient,
  platform: string,
): Promise<Map<string, PriceCostSnapshot>> {
  const [{ data: links, error: linksError }, { data: rateSetting, error: rateError }] =
    await Promise.all([
      admin
        .from('crm_product_price_links')
        .select('marketplace_product_key, price_item_id, product_title, size')
        .eq('platform', platform),
      admin.from('crm_settings').select('numeric_value').eq('key', 'usd_rate').maybeSingle(),
    ])
  if (linksError) throw linksError
  if (rateError) throw rateError

  const priceItemIds = [
    ...new Set(
      (links ?? [])
        .map((link) => text(link.price_item_id))
        .filter((priceItemId) => priceItemId.length > 0),
    ),
  ]
  if (!priceItemIds.length) return new Map()

  const { data: priceItems, error: priceItemsError } = await admin
    .from('crm_price_items')
    .select('id, usd, cost_uah')
    .in('id', priceItemIds)
  if (priceItemsError) throw priceItemsError

  const usdRate = number(rateSetting?.numeric_value)
  const priceItemById = new Map((priceItems ?? []).map((item) => [text(item.id), item]))
  const snapshots = new Map<string, PriceCostSnapshot>()
  for (const link of links ?? []) {
    const marketplaceProductKey = text(link.marketplace_product_key)
    const priceItemId = text(link.price_item_id)
    const priceItem = priceItemById.get(priceItemId)
    if (!marketplaceProductKey || !priceItem) continue
    const usd = priceItem.usd === null || priceItem.usd === undefined ? null : number(priceItem.usd)
    const snapshot = {
      priceItemId,
      costUsd: usd ?? 0,
      cost: usd === null ? number(priceItem.cost_uah) : usd * usdRate,
    }
    snapshots.set(marketplaceProductKey, snapshot)
  }
  return snapshots
}

export function findPlatformPriceCostSnapshot(
  snapshots: Map<string, PriceCostSnapshot>,
  _platform: string,
  marketplaceProductKey: string,
  _productTitle: string,
  _size: string,
): PriceCostMatch | undefined {
  const direct = snapshots.get(marketplaceProductKey)
  return direct ? { snapshot: direct, matchedKey: marketplaceProductKey } : undefined
}

export async function promoteLegacyPriceLink(
  admin: SupabaseClient,
  platform: string,
  legacyKey: string,
  canonicalKey: string,
  snapshot: PriceCostSnapshot | undefined,
  productTitle?: string,
  size?: string,
): Promise<boolean> {
  if (!legacyKey || !canonicalKey || legacyKey === canonicalKey || !snapshot) return false

  const { error } = await admin.from('crm_product_price_links').insert({
    platform,
    marketplace_product_key: canonicalKey,
    price_item_id: snapshot.priceItemId,
    product_title: productTitle || null,
    size: size || null,
  })
  if (!error) return true
  if (error.code === '23505') return false
  throw error
}

export function resolvedOrderItemCost(
  previous: RecordValue | undefined,
  linked: PriceCostSnapshot | undefined,
) {
  const costManual = previous?.cost_manual === true || previous?.costManual === true
  const existingCost = number(previous?.cost)
  const existingCostUsd = number(previous?.cost_usd ?? previous?.costUsd)
  const previousPriceItemId = text(previous?.price_item_id ?? previous?.priceItemId) || null
  const mayAutofill = !costManual && existingCost === 0 && existingCostUsd === 0

  return {
    cost: mayAutofill && linked ? linked.cost : existingCost,
    costUsd: mayAutofill && linked ? linked.costUsd : existingCostUsd,
    costManual,
    priceItemId: mayAutofill && linked ? linked.priceItemId : previousPriceItemId ?? linked?.priceItemId ?? null,
  }
}
