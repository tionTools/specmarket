import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { runTrackingWorker } from './worker.ts'
import {
  bulkTrackingEnabledFromRows,
  shouldBulkTrackPlatform,
} from './marketplace-pause.ts'

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

Deno.test('bulk tracking skips paused marketplaces, preserves enabled and manual orders', () => {
  const enabled = bulkTrackingEnabledFromRows([
    { platform: 'Пром', enabled: true },
    { platform: 'Эпицентр', enabled: true },
    { platform: 'Каста', enabled: false },
  ])
  assert(!shouldBulkTrackPlatform('Каста', enabled), 'paused Kasta must not be bulk-tracked')
  assert(shouldBulkTrackPlatform('Пром', enabled), 'enabled Prom must remain bulk-trackable')
  assert(shouldBulkTrackPlatform('Эпицентр', enabled), 'enabled Epicentr must remain bulk-trackable')
  assert(shouldBulkTrackPlatform('Ручной', enabled), 'manual orders must remain bulk-trackable')
  assert(shouldBulkTrackPlatform(null, enabled), 'orders without a marketplace remain bulk-trackable')
})

Deno.test('bulk tracking settings fail closed on incomplete or invalid rows', () => {
  for (const rows of [
    [{ platform: 'Каста', enabled: false }],
    [
      { platform: 'Пром', enabled: true },
      { platform: 'Эпицентр', enabled: true },
      { platform: 'Каста', enabled: 'false' },
    ],
  ]) {
    let threw = false
    try {
      bulkTrackingEnabledFromRows(rows as Array<{ platform: string; enabled: boolean }>)
    } catch {
      threw = true
    }
    assert(threw, 'missing or invalid settings must abort bulk tracking')
  }
})

Deno.test('forced bulk tracking makes no carrier or tracking-state calls for paused orders', async () => {
  const calls: string[] = []
  const admin = {
    from(table: string) {
      calls.push(table)
      if (table === 'crm_marketplace_settings') {
        return {
          select: async () => ({
            data: [
              { platform: 'Пром', enabled: true },
              { platform: 'Эпицентр', enabled: true },
              { platform: 'Каста', enabled: false },
            ],
            error: null,
          }),
        }
      }
      if (table === 'crm_orders') {
        return {
          select: () => ({
            or: () => ({
              not: async () => ({
                data: [{
                  id: 'paused-kasta',
                  platform: 'Каста',
                  external_id: 'kasta:123',
                  status: 'Отправлен',
                  shipping: 0,
                  delivery: { ttn: '12345678901234', carrier: 'Новая почта' },
                }],
                error: null,
              }),
            }),
          }),
        }
      }
      throw new Error(`Paused order unexpectedly accessed ${table}`)
    },
  } as unknown as SupabaseClient
  const result = await runTrackingWorker(admin, true)
  assert(result.body.ok === true && result.body.checked === 0 && result.body.updated === 0,
    'paused Kasta must not be tracked in a forced bulk run')
  assert(calls.join(',') === 'crm_marketplace_settings,crm_orders',
    'paused orders must be excluded before tracking-state or carrier requests')
})

Deno.test('targeted tracking does not require an enabled marketplace setting', async () => {
  const calls: string[] = []
  const admin = {
    from(table: string) {
      calls.push(table)
      if (table === 'crm_orders') {
        return {
          select: () => ({
            eq: async () => ({
              data: [{
                id: 'specific-kasta',
                platform: 'Каста',
                external_id: 'kasta:123',
                status: 'Отправлен',
                shipping: 0,
                delivery: { ttn: '' },
              }],
              error: null,
            }),
          }),
        }
      }
      if (table === 'crm_delivery_tracking_state') {
        return { select: () => ({ in: async () => ({ data: [], error: null }) }) }
      }
      throw new Error(`Unexpected query ${table}`)
    },
  } as unknown as SupabaseClient
  const result = await runTrackingWorker(admin, true, 'specific-kasta')
  assert(result.body.ok === true, 'specific-order tracking remains available')
  assert(!calls.includes('crm_marketplace_settings'),
    'targeted tracking must not be blocked by the bulk-pause setting')
})
