import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const root = new URL('../../../', import.meta.url)
const source = readFileSync(
  new URL('supabase/functions/_shared/targeted-feed-fast-path.ts', root),
  'utf8',
)
const context = { exports: {} }
runInNewContext(
  ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }),
  context,
)
const shouldLoad = context.exports.shouldLoadMarketplaceFeed
assert.equal(typeof shouldLoad, 'function')
assert.equal(shouldLoad(false, [], true), true, 'bulk Prom still fetches the feed')
assert.equal(shouldLoad(false, [], false), true, 'bulk Kasta still fetches the feed')
assert.equal(shouldLoad(true, [], true), false, 'empty targeted orders do not fetch catalogues')
assert.equal(shouldLoad(true, [{ hasSize: true, hasImage: true }], true), false)
assert.equal(shouldLoad(true, [{ hasSize: false, hasImage: true }], true), true)
assert.equal(shouldLoad(true, [{ hasSize: true, hasImage: false }], true), true)
assert.equal(shouldLoad(true, [{ hasImage: true }]), false, 'Kasta needs only an image')
assert.equal(shouldLoad(true, [{ hasImage: false }]), true)
assert.equal(shouldLoad(true, [{ hasImage: true }, { hasImage: false }]), true)

const prom = readFileSync(new URL('supabase/functions/sync-prom-orders/index.ts', root), 'utf8')
const epicentr = readFileSync(
  new URL('supabase/functions/sync-epicentr-orders/index.ts', root),
  'utf8',
)
const kasta = readFileSync(new URL('supabase/functions/sync-kasta-orders/index.ts', root), 'utf8')

function actualFeedCoverage(source, bindings) {
  const file = ts.createSourceFile('sync.ts', source, ts.ScriptTarget.Latest, true)
  let expression
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'feedCoverage')
      expression = node.initializer?.getText(file)
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(expression, 'the actual handler must calculate feed coverage')
  const scope = { exports: {}, ...bindings }
  runInNewContext(
    ts.transpile(`exports.coverage = ${expression}`, {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    }),
    scope,
  )
  return scope.exports.coverage
}

const text = (value) => String(value ?? '')
const pick = (item, ...keys) => keys.map((key) => item[key]).find((value) => value !== undefined)
const promItem = { key: 'same-product', size: 'M' }
const promPrevious = {
  position: 0,
  marketplace_product_key: 'same-product',
  image_url: 'saved.jpg',
}
const promBindings = {
  requestedExternalId: '42',
  candidates: [{ id: '42', items: [promItem] }],
  existingByExternalId: new Map([['prom:42', { id: 'saved-order' }]]),
  itemsByOrder: new Map([['saved-order', [promPrevious]]]),
  sourceItems: (order) => order.items,
  text,
  pick,
  productSize: (item) => item.size ?? '',
  promLegacyProductKeys: (item) => [item.key],
  mappedFamilyKey: () => '',
  productFamilyMappings: new Map(),
}
assert.equal(shouldLoad(true, actualFeedCoverage(prom, promBindings), true), false)
assert.equal(
  shouldLoad(
    true,
    actualFeedCoverage(prom, {
      ...promBindings,
      candidates: [{ id: '42', items: [{ key: 'new-product', size: 'M' }] }],
    }),
    true,
  ),
  true,
  'a changed Prom product without an image still needs the feed',
)

const kastaItem = { key: 'same-product' }
const kastaBindings = {
  targetOrderId: '42',
  candidates: [{ id: '42', items: [kastaItem] }],
  existingByExternalId: new Map([['kasta:42', { id: 'saved-order' }]]),
  itemsByOrder: new Map([['saved-order', [promPrevious]]]),
  itemRows: (order) => order.items,
  text,
  itemImage: (item) => item.image ?? '',
  kastaProductKey: (item) => item.key,
}
assert.equal(shouldLoad(true, actualFeedCoverage(kasta, kastaBindings)), false)
assert.equal(
  shouldLoad(
    true,
    actualFeedCoverage(kasta, {
      ...kastaBindings,
      candidates: [{ id: '42', items: [{ key: 'new-product' }] }],
    }),
  ),
  true,
  'a changed Kasta product without an image still needs the feed',
)
assert.match(
  prom,
  /shouldLoadMarketplaceFeed\(Boolean\(requestedExternalId\), feedCoverage, true\)/,
)
assert.match(prom, /const \[localizedName, apiSize\] = await Promise\.all\(/)
assert.match(kasta, /shouldLoadMarketplaceFeed\(Boolean\(targetOrderId\), feedCoverage\)/)
assert.match(epicentr, /if \(!requestedExternalId\) \{\s*const detailResponse = await fetch\(/)
assert.match(prom, /apply_crm_marketplace_order_snapshot/)
assert.match(epicentr, /apply_crm_marketplace_order_snapshot/)
assert.match(kasta, /apply_crm_marketplace_order_snapshot/)
console.log('Targeted marketplace sync performance: Prom/Epicentr/Kasta fast paths PASS')
