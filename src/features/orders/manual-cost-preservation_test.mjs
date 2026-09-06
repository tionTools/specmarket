import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { currencyRateForDate } from '../prices/currencyRates.ts'

// Run the actual SFC handlers with an in-memory order store; no production access.
const source = readFileSync(new URL('../../pages/HomeView.vue', import.meta.url), 'utf8')
const script = source.split('<script setup lang="ts">')[1].split('</script>')[0]
const parsed = ts.createSourceFile('HomeView.ts', script, ts.ScriptTarget.Latest, true)
const names = [
  'cloneOrder',
  'openEditOrderDialog',
  'saveOrderDraft',
  'repriceOrderDraft',
  'updateDraftUsdCost',
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

const original = {
  id: 1,
  date: '2026-09-09',
  products: [
    { id: 'a', costUsd: 10, cost: 452 },
    { id: 'b', costUsd: 10, cost: 452 },
  ],
}
const rates = [
  { effective_from: '2000-01-01', rate: 47 },
  { effective_from: '2026-09-10', rate: 46 },
]
const storage = new Map()
const context = {
  console,
  toRaw: (value) => value,
  isGuest: { value: false },
  isSavingOrderDraft: { value: false },
  orderDraft: { value: null },
  orderDraftError: { value: '' },
  editingManualOrderId: { value: null },
  orderDialog: { value: null },
  orders: { value: [structuredClone(original)] },
  usdRateForOrderDate: (date) => currencyRateForDate(rates, date),
  validateOrderDraft: () => '',
  preserveManualDeliveryHistory: () => {},
  sortOrders: () => {},
  persistOrders: async (order) => {
    context.saved = structuredClone(order)
  },
  normalizedOrderDraft: () => structuredClone(context.orderDraft.value),
  manualOrderPriceDraftStorageKey: 'draft',
  manualOrderPriceSelectionStorageKey: 'selection',
  window: {
    sessionStorage: {
      getItem: (key) => storage.get(key),
      removeItem: (key) => storage.delete(key),
    },
  },
}
runInNewContext(ts.transpile(handlers, { target: ts.ScriptTarget.ES2022 }), context)
context.openEditOrderDialog(original)
assert.equal(context.orderDraft.value.products[0].cost, 452)
await context.saveOrderDraft()
assert.equal(context.saved.products[0].cost, 452, 'ordinary save preserves historical cost')
assert.equal(context.saved.products[1].cost, 452)

context.orderDraft.value.date = '2026-09-10'
context.repriceOrderDraft()
assert.ok(context.orderDraft.value.products.every((product) => product.cost === 460))
context.updateDraftUsdCost(context.orderDraft.value.products[0], { target: { value: '12' } })
assert.equal(context.orderDraft.value.products[0].cost, 552)
assert.equal(context.orderDraft.value.products[1].cost, 460, 'USD edit affects only one item')

storage.set('draft', JSON.stringify({ draft: original, editingId: 1, productId: 'a' }))
assert.equal(context.restoreManualOrderDraftFromPriceSelection(), true)
assert.equal(context.orderDraft.value.products[0].cost, 452, 'restore alone preserves cost')
storage.set('draft', JSON.stringify({ draft: original, editingId: 1, productId: 'a' }))
storage.set('selection', JSON.stringify({ productId: 'a', priceItemId: 'price', costUsd: 20 }))
assert.equal(context.restoreManualOrderDraftFromPriceSelection(), true)
assert.equal(context.orderDraft.value.products[0].cost, 940, 'selected item uses draft-date rate')
assert.equal(context.orderDraft.value.products[1].cost, 452, 'selection preserves other items')

const load = parsed.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'loadRemoteOrders',
)
assert.ok(!load.getText(parsed).includes('repriceOrderDraft'))
assert.ok(!/watch\([^;]*orderDraft\.value\.date[^;]*repriceOrderDraft/.test(script))
assert.ok(source.includes('@change="repriceOrderDraft"'))
console.log('Manual cost preservation: open/save/restore/date/USD/price selection OK')
