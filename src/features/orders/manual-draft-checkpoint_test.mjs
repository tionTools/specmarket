import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../../pages/HomeView.vue', import.meta.url), 'utf8')
const script = source.split('<script setup lang="ts">')[1].split('</script>')[0]
const parsed = ts.createSourceFile('HomeView.ts', script, ts.ScriptTarget.Latest, true)
const names = [
  'cloneOrder',
  'persistActiveManualOrderDraft',
  'cancelOrderDraft',
  'openDraftPricePicker',
  'restoreManualOrderDraftFromPriceSelection',
]
const handlers = parsed.statements
  .filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
  .map((node) => node.getText(parsed))
  .join('\n')
assert.equal(
  parsed.statements.filter(
    (node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text),
  ).length,
  names.length,
)

const storage = new Map()
const checkpointKey = 'specmarket-crm-manual-order-price-draft'
const selectionKey = 'specmarket-crm-manual-order-price-selection'
const draft = {
  customer: 'Ірина',
  phone: '0501112233',
  platform: 'Пром',
  status: 'Новий',
  date: '2026-09-09',
  time: '10:15',
  shipping: 70,
  acquiring: 12,
  delivery: { paymentMethod: 'Післяплата', city: 'Київ', address: 'Відділення 3' },
  products: [
    { id: 'one', name: 'Товар 1', quantity: 2, price: 300, cost: 452, costUsd: 10 },
    { id: 'two', name: 'Товар 2', quantity: 1, price: 200, cost: 150, costUsd: 0 },
  ],
}
const context = {
  console,
  toRaw: (value) => value,
  isGuest: { value: false },
  orderDraft: { value: structuredClone(draft) },
  orderDraftError: { value: '' },
  editingManualOrderId: { value: null },
  orderDialog: { value: { close: () => (context.closed = true) } },
  router: { push: async (value) => (context.route = value) },
  usdRateForOrderDate: () => 45.2,
  manualOrderPriceDraftStorageKey: checkpointKey,
  manualOrderPriceSelectionStorageKey: selectionKey,
  window: {
    sessionStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
  },
}
runInNewContext(ts.transpile(handlers, { target: ts.ScriptTarget.ES2022 }), context)

await context.openDraftPricePicker(context.orderDraft.value.products[0])
assert.deepEqual(
  JSON.parse(storage.get(checkpointKey)).draft,
  draft,
  'picker stores every draft field',
)
assert.equal(context.route.path, '/prices')

context.orderDraft.value.products[1].price = 222
context.persistActiveManualOrderDraft()
const remount = { ...context, orderDraft: { value: {} }, editingManualOrderId: { value: null } }
runInNewContext(ts.transpile(handlers, { target: ts.ScriptTarget.ES2022 }), remount)
assert.equal(
  remount.restoreManualOrderDraftFromPriceSelection(),
  true,
  'browser Back restores checkpoint',
)
assert.equal(remount.orderDraft.value.customer, 'Ірина')
assert.equal(remount.orderDraft.value.products[1].price, 222)
assert.ok(storage.has(checkpointKey), 'checkpoint survives restore')

storage.set(
  selectionKey,
  JSON.stringify({ productId: 'one', priceItemId: 'price-usd', costUsd: 12 }),
)
assert.equal(remount.restoreManualOrderDraftFromPriceSelection(), true, 'price selection restores')
assert.ok(Math.abs(remount.orderDraft.value.products[0].cost - 542.4) < 0.000001)
assert.equal(
  remount.orderDraft.value.products[1].cost,
  150,
  'selection leaves other products unchanged',
)
assert.ok(storage.has(checkpointKey), 'checkpoint remains after selection')
assert.ok(!storage.has(selectionKey), 'selection is consumed')

remount.cancelOrderDraft()
assert.ok(!storage.has(checkpointKey), 'explicit cancel clears checkpoint')
assert.ok(remount.closed, 'explicit cancel closes dialog')

assert.match(source, /window\.sessionStorage\.removeItem\(manualOrderPriceDraftStorageKey\)/)
assert.match(source, /@cancel\.prevent="cancelOrderDraft"/)
assert.match(source, /@click="cancelOrderDraft"/)
assert.match(source, /hasManualDraftCheckpoint/)
console.log('Manual draft checkpoint round-trip: OK')
