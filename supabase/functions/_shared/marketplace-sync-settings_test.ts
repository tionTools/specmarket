import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  loadMarketplaceSyncAccess,
  marketplacePausedResponse,
  marketplaceSettingsUnavailableResponse,
  shouldSkipMarketplaceSync,
} from './marketplace-sync-settings.ts'

function assert(value: unknown): asserts value {
  if (!value) throw new Error('Assertion failed')
}

function fakeAdmin(data: unknown, error: unknown = null) {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      assert(name === 'get_crm_marketplace_sync_access')
      assert(args.p_platform === 'Каста')
      return { data, error }
    },
  } as unknown as SupabaseClient
}

Deno.test('marketplace access returns both setting and secret in one RPC', async () => {
  const access = await loadMarketplaceSyncAccess(fakeAdmin({ secret: 'private', enabled: false }), 'Каста')
  assert(access.secret === 'private' && access.enabled === false)
})

Deno.test('marketplace access fails closed on absent, invalid, or failed configuration', async () => {
  for (const [data, error] of [
    [null, null],
    [{ secret: 'private' }, null],
    [{ secret: 'private', enabled: 'false' }, null],
    [{ secret: '', enabled: true }, null],
    [null, { message: 'RPC failed' }],
  ] as const) {
    let rejected = false
    try {
      await loadMarketplaceSyncAccess(fakeAdmin(data, error), 'Каста')
    } catch {
      rejected = true
    }
    assert(rejected)
  }
})

Deno.test('marketplace pause blocks cron and manual bulk sync, but allows one targeted order', async () => {
  assert(shouldSkipMarketplaceSync(false, true, ''))
  assert(shouldSkipMarketplaceSync(false, false, ''))
  assert(shouldSkipMarketplaceSync(false, true, 'order-1'))
  assert(!shouldSkipMarketplaceSync(false, false, 'order-1'))
  assert(!shouldSkipMarketplaceSync(true, true, ''))
  assert(!shouldSkipMarketplaceSync(true, false, ''))
  const paused = marketplacePausedResponse({})
  assert(paused.status === 200)
  const pausedJson = await paused.json()
  assert(pausedJson.ok === true && pausedJson.skipped === 'paused')
  const unavailable = marketplaceSettingsUnavailableResponse({})
  assert(unavailable.status === 503)
})
