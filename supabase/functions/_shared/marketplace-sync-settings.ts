import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export type MarketplaceSyncAccess = { secret: string; enabled: boolean }

export async function loadMarketplaceSyncAccess(
  admin: SupabaseClient,
  platform: 'Пром' | 'Эпицентр' | 'Каста',
): Promise<MarketplaceSyncAccess> {
  const { data, error } = await admin.rpc('get_crm_marketplace_sync_access', { p_platform: platform })
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('MARKETPLACE_SETTINGS_UNAVAILABLE')
  }
  const access = data as Record<string, unknown>
  if (typeof access.secret !== 'string' || !access.secret ||
    typeof access.enabled !== 'boolean') {
    throw new Error('MARKETPLACE_SETTINGS_UNAVAILABLE')
  }
  return { secret: access.secret, enabled: access.enabled }
}

export function shouldSkipAutomaticMarketplaceSync(isScheduledRequest: boolean, enabled: boolean): boolean {
  return isScheduledRequest && !enabled
}

export function marketplacePausedResponse(headers: Record<string, string>): Response {
  return Response.json(
    { ok: true, skipped: 'paused', received: 0, created: 0, updated: 0, changedOrderIds: [] },
    { headers },
  )
}

export function marketplaceSettingsUnavailableResponse(headers: Record<string, string>): Response {
  return Response.json(
    { ok: false, code: 'MARKETPLACE_SETTINGS_UNAVAILABLE', message: 'Не удалось проверить настройки синхронизации маркетплейсов.' },
    { status: 503, headers },
  )
}
