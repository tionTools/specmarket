import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export type MarketplacePlatform = 'Пром' | 'Эпицентр' | 'Каста'

export type MarketplaceOrderSyncState = {
  external_id: string
  source_hash: string
  order_id: string
  synced_at: string
}

export type MarketplaceOrderSyncContext = {
  deletedExternalIds: Set<string>
  stateByExternalId: Map<string, MarketplaceOrderSyncState>
}

const text = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''

export async function loadMarketplaceOrderSyncContext(
  admin: SupabaseClient,
  platform: MarketplacePlatform,
  externalIds: string[],
): Promise<MarketplaceOrderSyncContext> {
  const ids = [...new Set(externalIds.map((value) => text(value)).filter(Boolean))]
  if (!ids.length) {
    return { deletedExternalIds: new Set(), stateByExternalId: new Map() }
  }

  const { data, error } = await admin.rpc('get_crm_marketplace_order_sync_context', {
    p_platform: platform,
    p_external_ids: ids,
  })
  if (error) throw error

  const deletedExternalIds = new Set<string>()
  const stateByExternalId = new Map<string, MarketplaceOrderSyncState>()
  for (const value of Array.isArray(data) ? data : []) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const row = value as Record<string, unknown>
    const externalId = text(row.external_id)
    if (!externalId) continue
    if (row.is_deleted === true) deletedExternalIds.add(externalId)

    const sourceHash = text(row.source_hash)
    if (!sourceHash) continue
    stateByExternalId.set(externalId, {
      external_id: externalId,
      source_hash: sourceHash,
      order_id: text(row.order_id),
      synced_at: text(row.synced_at),
    })
  }
  return { deletedExternalIds, stateByExternalId }
}
