import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { loadMarketplaceOrderSyncContext } from './marketplace-order-sync-context.ts'

function assert(value: unknown): asserts value {
  if (!value) throw new Error('Assertion failed')
}

Deno.test('marketplace order sync context uses one RPC and separates deleted/state rows', async () => {
  let calls = 0
  const admin = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls += 1
      assert(name === 'get_crm_marketplace_order_sync_context')
      assert(args.p_platform === 'Пром')
      assert(Array.isArray(args.p_external_ids))
      assert(args.p_external_ids.length === 2)
      return {
        data: [
          {
            external_id: 'prom:1',
            is_deleted: true,
            source_hash: null,
            order_id: null,
            synced_at: null,
          },
          {
            external_id: 'prom:2',
            is_deleted: false,
            source_hash: 'hash-2',
            order_id: 'order-2',
            synced_at: '2026-09-28T20:00:00Z',
          },
        ],
        error: null,
      }
    },
  } as unknown as SupabaseClient

  const context = await loadMarketplaceOrderSyncContext(
    admin,
    'Пром',
    ['prom:1', 'prom:2', 'prom:2', ''],
  )

  assert(calls === 1)
  assert(context.deletedExternalIds.has('prom:1'))
  assert(!context.deletedExternalIds.has('prom:2'))
  assert(context.stateByExternalId.size === 1)
  assert(context.stateByExternalId.get('prom:2')?.source_hash === 'hash-2')
})

Deno.test('marketplace order sync context skips RPC for an empty id list', async () => {
  const admin = {
    rpc: async () => {
      throw new Error('RPC must not be called')
    },
  } as unknown as SupabaseClient

  const context = await loadMarketplaceOrderSyncContext(admin, 'Каста', [])
  assert(context.deletedExternalIds.size === 0)
  assert(context.stateByExternalId.size === 0)
})
