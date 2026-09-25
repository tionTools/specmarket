import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const helperSource = readFileSync(
  new URL('../../../supabase/functions/_shared/deleted-marketplace-orders.ts', import.meta.url),
  'utf8',
)
const prom = readFileSync(
  new URL('../../../supabase/functions/sync-prom-orders/index.ts', import.meta.url),
  'utf8',
)
const epicentr = readFileSync(
  new URL('../../../supabase/functions/sync-epicentr-orders/index.ts', import.meta.url),
  'utf8',
)
const home = readFileSync(new URL('../../pages/HomeView.vue', import.meta.url), 'utf8')
const context = { exports: {} }
runInNewContext(
  ts.transpile(helperSource, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  }),
  context,
)
const exclude = context.exports.excludeDeletedMarketplaceOrders
assert.equal(typeof exclude, 'function')

const promOrders = [{ id: '101' }, { id: '202' }]
const removedProm = new Set(['prom:101'])
for (const mode of ['incremental', 'full', 'single']) {
  const result = exclude(promOrders, removedProm, (order) => `prom:${order.id}`)
  assert.deepEqual(
    Array.from(result.orders, (order) => order.id),
    ['202'],
    mode,
  )
  assert.equal(result.deletedSkipped, 1, mode)
}
const epicentrOrders = [{ id: '123456' }, { id: '654321' }]
const result = exclude(epicentrOrders, new Set(['123456', 'prom:654321']), (order) => order.id)
assert.deepEqual(
  Array.from(result.orders, (order) => order.id),
  ['654321'],
)
assert.equal(result.deletedSkipped, 1)
assert.equal(exclude(epicentrOrders, new Set(), (order) => order.id).deletedSkipped, 0)

for (const [source, platform, filter, candidateMarker] of [
  [
    prom,
    'Пром',
    '(order) => `prom:${text(order.id)}`',
    'const candidates = importableOrders.filter(',
  ],
  [epicentr, 'Эпицентр', '(order) => order.id', 'orders = importableOrders.filter('],
]) {
  const tableLookup = source.indexOf(".from('crm_deleted_marketplace_orders')")
  const filtering = source.indexOf('excludeDeletedMarketplaceOrders(')
  const candidateSelection = source.indexOf(candidateMarker)
  assert.ok(tableLookup >= 0, platform + ': lookup deleted IDs')
  assert.ok(
    source.includes(`.eq('platform', '${platform}')`),
    platform + ': platform-scoped lookup',
  )
  assert.ok(source.includes(filter), platform + ': correct external ID format')
  assert.ok(
    filtering > tableLookup && candidateSelection > filtering,
    platform + ': tombstone before candidates',
  )
  assert.ok(source.includes('if (deletedOrdersError)'), platform + ': fail closed on lookup error')
  assert.ok(source.includes('deletedSkipped'), platform + ': skipped count is reported')
}
assert.match(
  home,
  /order\.platform === 'Каста'\s*\|\|\s*order\.platform === 'Пром'\s*\|\|\s*order\.platform === 'Эпицентр'/,
)
assert.match(home, /platform: order\.platform,\s*external_id: order\.externalId,/)
assert.match(home, /void bankBalancesCard\.value\?\.refreshDebt\(\)/)
console.log('Deleted marketplace order regression: Prom/Epicentr tombstones and debt refresh PASS')
