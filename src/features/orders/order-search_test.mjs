import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { computed, ref } from 'vue'
import ts from 'typescript'

const source = readFileSync(new URL('../../pages/HomeView.vue', import.meta.url), 'utf8')
const script = source.split('<script setup lang="ts">')[1].split('</script>')[0]
const parsed = ts.createSourceFile('HomeView.ts', script, ts.ScriptTarget.Latest, true)
const names = ['orderSearchCache', 'searchableOrder', 'matchingOrders', 'visibleOrders', 'isSearchPending', 'displayedOrders']
const statements = parsed.statements.filter((node) =>
  names.includes(ts.isFunctionDeclaration(node)
    ? node.name?.text
    : ts.isVariableStatement(node)
      ? node.declarationList.declarations[0]?.name.getText(parsed)
      : ''),
)
assert.equal(statements.length, names.length)
const compiled = ts.transpile(statements.map((node) => node.getText(parsed)).join('\n') +
  '\nglobalThis.result = { matchingOrders, visibleOrders, isSearchPending, displayedOrders }', {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.None,
})

const orders = ref(Array.from({ length: 1000 }, (_, index) => ({
  id: index + 1,
  displayNumber: String(58000000 + index),
  date: '08.11.2026',
  customer: index === 0 ? 'Иваненко' : `Покупатель ${index}`,
  phone: index === 6 ? '+380501112233' : '+380500000000',
  products: [{ name: index === 1 ? 'Сапоги' : 'Товар' }],
  delivery: {
    ttn: index === 2 ? '2045-1579-1911-52' : '',
    recipient: index === 3 ? 'Петренко' : '',
    recipientPhone: index === 7 ? '+380671234567' : '',
    paymentMethod: index === 4 ? 'monobank' : '',
  },
})))
const debouncedSearchQuery = ref('')
const searchQuery = ref('')
const searchLimit = ref(50)
const isShowingNotInExcel = ref(false)
const isShowingUnpaidOnly = ref(false)
let serializations = 0
const context = {
  computed,
  orders,
  debouncedSearchQuery,
  searchQuery,
  searchLimit,
  orderListRange: ref({ from: new Date(2026, 10, 1), to: new Date(2026, 10, 30) }),
  platformFilter: ref('all'),
  isShowingCancellations: ref(false),
  isShowingReturns: ref(false),
  isShowingUnshipped: ref(false),
  isShowingNotInExcel,
  isShowingUnpaidOnly,
  isPromRegistryView: ref(false),
  promRegistryOrders: ref([]),
  JSON: { stringify: (value) => { serializations++; return JSON.stringify(value) } },
  displayPaymentMethod: (method) => method === 'monobank' ? 'Оплата через Монобанк' : '',
  orderHeaderPaymentLabel: (order) => order.id === 5 ? 'Оплата Monobank' : '',
  promPaymentState: (order) => order.id === 6 ? 'paid' : null,
  deliveryTtns: (delivery) => [delivery.ttn],
  getOrderLifecycleState: () => 'active',
  displayOrderStatus: () => 'Принят',
  orderBusinessPlatform: () => 'Пром',
  isOrderVisibleInMainList: () => true,
  parseOrderDate: () => new Date(2026, 10, 8),
  isEpicentrCancelledBeforeShipment: () => false,
  isReturnArrivedDelivery: () => false,
  isReturnLifecycleState: () => false,
  orderStatusTone: () => 'blue',
  isOrderNotInExcel: () => false,
  isUnpaidShipmentOrder: () => false,
}
runInNewContext(compiled, context)
const { matchingOrders, visibleOrders, isSearchPending, displayedOrders } = context.result
assert.equal(matchingOrders.value.length, 1000)
assert.equal(serializations, 0, 'empty search must not build search text')

function check(query, expectedId) {
  searchQuery.value = query
  debouncedSearchQuery.value = query
  assert.deepEqual(Array.from(visibleOrders.value, (order) => order.id), [expectedId])
}
isShowingNotInExcel.value = true
isShowingUnpaidOnly.value = true
searchQuery.value = 'сапоги'
assert.equal(isSearchPending.value, true)
assert.equal(displayedOrders.value.length, 0, 'old matches stay hidden during debounce')
check('58000000', 1)
check('20451579191152', 3)
check('иваненко', 1)
check('петренко', 4)
check('380501112233', 7)
check('380671234567', 8)
check('сапоги', 2)
check('монобанк', 5)
check('оплачено', 6)
assert.equal(serializations, 1000, 'typing must reuse cached search text')
orders.value[1].products[0].name = 'Кроссовки'
check('кроссовки', 2)
assert.equal(serializations, 1001, 'only changed order is reindexed')
searchQuery.value = 'товар'
debouncedSearchQuery.value = 'товар'
assert.equal(visibleOrders.value.length, 999)
assert.equal(displayedOrders.value.length, 50)
searchLimit.value = 100
assert.equal(displayedOrders.value.length, 100)
searchQuery.value = ''
debouncedSearchQuery.value = ''
assert.equal(displayedOrders.value.length, 0, 'clearing search restores the active filters')
assert.equal(serializations, 1001, 'clearing search must not rebuild search text')

console.log('Order search: categories, cache invalidation, filters, limit and clear OK')
