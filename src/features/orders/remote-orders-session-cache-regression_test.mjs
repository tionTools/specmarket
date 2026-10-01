import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const storage = new Map()
globalThis.window = {
  sessionStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  },
}

const {
  clearRemoteOrdersSessionCache,
  readRemoteOrdersSessionCache,
  writeRemoteOrdersSessionCache,
} = await import('./remoteOrdersSessionCache.ts')

const cacheKey = 'specmarket-crm-remote-orders-session-v2'
const legacyCacheKey = 'specmarket-crm-remote-orders-session-v1'
const validOrder = {
  id: 1,
  remoteId: 'remote-1',
  displayNumber: '1',
  date: '01.10.2026',
  customer: 'Тест',
  phone: '+380501112233',
  platform: 'Пром',
  status: 'Новий',
  products: [
    {
      id: 'item-1',
      position: 0,
      name: 'Товар',
      size: 'L',
      quantity: 1,
      price: 100,
      cost: 50,
      costUsd: 0,
    },
  ],
  shipping: 0,
  paymentAmount: 0,
  acquiring: 0,
  acquiringPercent: 0,
  extraExpenses: 0,
  delivery: {
    carrier: 'Новая почта',
    ttn: '',
    recipient: 'Тест',
    recipientPhone: '+380501112233',
    city: 'Харьков',
    address: '1',
    status: 'Запланировано',
    payer: 'Получатель',
    paymentAmount: 0,
  },
}

writeRemoteOrdersSessionCache(
  'user-1',
  [validOrder, { ...validOrder, id: 2, remoteId: undefined }],
  new Map([
    ['remote-1', 'v1'],
    ['local-only', 'v0'],
  ]),
)
assert.ok(!storage.has(legacyCacheKey), 'write removes legacy v1 cache')
assert.deepEqual(
  readRemoteOrdersSessionCache('user-1')?.orders.map((order) => order.remoteId),
  ['remote-1'],
  'cache keeps only remote orders',
)
assert.equal(
  readRemoteOrdersSessionCache('other-user'),
  null,
  'cache from another authenticated user is ignored',
)

const malformedOrders = [
  { remoteId: 'remote-1' },
  { ...validOrder, products: undefined },
  { ...validOrder, products: [{}] },
  { ...validOrder, delivery: undefined },
  { ...validOrder, delivery: { ...validOrder.delivery, ttn: undefined } },
  { ...validOrder, platform: 'unexpected' },
]
for (const order of malformedOrders) {
  storage.set(
    cacheKey,
    JSON.stringify({ userId: 'user-1', orders: [order], versions: { 'remote-1': 'v1' } }),
  )
  assert.equal(
    readRemoteOrdersSessionCache('user-1'),
    null,
    'malformed cached order invalidates the whole cache',
  )
}

storage.delete(cacheKey)
storage.set(
  legacyCacheKey,
  JSON.stringify({ userId: 'user-1', orders: [validOrder], versions: { 'remote-1': 'v1' } }),
)
assert.equal(readRemoteOrdersSessionCache('user-1'), null, 'legacy v1 cache is invalidated')
clearRemoteOrdersSessionCache()
assert.ok(!storage.has(cacheKey) && !storage.has(legacyCacheKey), 'clear removes both cache versions')

const homeSource = readFileSync(new URL('../../pages/HomeView.vue', import.meta.url), 'utf8')
const homeScript = homeSource.split('<script setup lang="ts">')[1].split('</script>')[0]
const parsed = ts.createSourceFile('HomeView.ts', homeScript, ts.ScriptTarget.Latest, true)
const names = [
  'persistConfirmedRemoteOrdersSessionCache',
  'persistRemoteOrdersSessionCache',
  'orderWithRegistryFinancialsRestored',
  'restorePromRegistryFinancials',
  'cloneOrder',
]
const statements = parsed.statements.filter(
  (node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text),
)
assert.equal(statements.length, names.length, 'cache/registry helpers must remain extractable')

const previewOrder = structuredClone(validOrder)
previewOrder.paymentAmount = 999
previewOrder.acquiring = 25
previewOrder.acquiringPercent = 25
previewOrder.delivery.paymentAmount = 999

const captured = []
const context = {
  toRaw: (value) => value,
  user: { value: { id: 'user-1' } },
  orders: { value: [previewOrder] },
  remoteOrderVersions: new Map([['remote-1', 'server-v1']]),
  editingOrderCell: { value: null },
  pendingLocalOrderSaves: new Map(),
  isPromRegistryDraft: { value: true },
  promRegistryOriginalFinancials: new Map([
    [
      1,
      {
        paymentAmount: 0,
        acquiring: 0,
        acquiringPercent: 0,
      },
    ],
  ]),
  promRegistryExpectedFinancials: new Map(),
  promRegistryPendingOperationIds: new Map(),
  promRegistryNewFields: { value: new Set() },
  promRegistryMismatchedFields: { value: new Set() },
  promRegistryExistingFinancials: { value: { complete: 0, partial: 0 } },
  writeRemoteOrdersSessionCache: (userId, orders, versions) => {
    captured.push({
      userId,
      orders: structuredClone(orders),
      versions: new Map(versions),
    })
  },
}
runInNewContext(
  ts.transpile(statements.map((node) => node.getText(parsed)).join('\n'), {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.None,
  }),
  context,
)

context.editingOrderCell.value = '1-payment-amount'
context.persistRemoteOrdersSessionCache()
assert.equal(captured.length, 0, 'active inline edit must not enter the session cache')
context.editingOrderCell.value = null
context.pendingLocalOrderSaves.set('remote-1', 1)
context.persistRemoteOrdersSessionCache()
assert.equal(captured.length, 0, 'pending local save must not enter the session cache before success')
context.pendingLocalOrderSaves.clear()

context.persistRemoteOrdersSessionCache()
assert.equal(captured.length, 1)
assert.equal(
  captured[0].orders[0].paymentAmount,
  0,
  'registry preview payment must never enter the session cache',
)
assert.equal(
  captured[0].orders[0].delivery.paymentAmount,
  0,
  'nested delivery payment must also use the confirmed value',
)
assert.equal(captured[0].orders[0].acquiring, 0, 'registry preview acquiring stays out of cache')

context.restorePromRegistryFinancials()
assert.equal(context.orders.value[0].paymentAmount, 0, 'cancel restores confirmed payment in memory')
assert.equal(
  captured[0].orders[0].paymentAmount,
  context.orders.value[0].paymentAmount,
  'cache and memory agree after preview cancel/reload scenario',
)

context.isPromRegistryDraft.value = false
context.orders.value[0].paymentAmount = 123
context.orders.value[0].delivery.paymentAmount = 123
context.persistRemoteOrdersSessionCache()
assert.equal(
  captured.at(-1).orders[0].paymentAmount,
  123,
  'confirmed ordinary financial values remain cacheable',
)

const queueNames = [
  'persistConfirmedRemoteOrdersSessionCache',
  'orderWithRegistryFinancialsRestored',
  'incrementPendingLocalSaves',
  'decrementPendingLocalSaves',
  'persistOrders',
  'markRemoteOrderLocallyChanged',
  'cloneOrder',
]
const queueStatements = parsed.statements.filter(
  (node) => ts.isFunctionDeclaration(node) && queueNames.includes(node.name?.text),
)
assert.equal(queueStatements.length, queueNames.length, 'queued-save helpers must remain extractable')

let firstResolve
let secondReject
const firstGate = new Promise((resolve) => {
  firstResolve = resolve
})
const secondGate = new Promise((_, reject) => {
  secondReject = reject
})
let persistCall = 0
const queuedCacheWrites = []
const queuedOrder = structuredClone(validOrder)
queuedOrder.paymentAmount = 10
queuedOrder.delivery.paymentAmount = 10
const queueContext = {
  console,
  toRaw: (value) => value,
  isGuest: { value: false },
  user: { value: { id: 'user-1' } },
  orders: { value: [queuedOrder] },
  editingOrderCell: { value: null },
  isPromRegistryDraft: { value: false },
  promRegistryOriginalFinancials: new Map(),
  pendingLocalOrderSaves: new Map(),
  deferredRemoteOrderIds: new Set(),
  remoteOrderVersions: new Map([['remote-1', 'server-v1']]),
  localRemoteOrderRevisions: new Map(),
  persistenceQueue: Promise.resolve(),
  queueRemoteOrderRefresh: () => {},
  writeRemoteOrdersSessionCache: (_userId, orders) => {
    queuedCacheWrites.push(structuredClone(orders))
  },
  persistOrdersNow: async (_savedOrders, localOrders) => {
    persistCall += 1
    if (persistCall === 1) {
      await firstGate
      return localOrders
    }
    await secondGate
    return localOrders
  },
}
runInNewContext(
  ts.transpile(queueStatements.map((node) => node.getText(parsed)).join('\n'), {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.None,
  }),
  queueContext,
)

const firstSave = queueContext.persistOrders(queueContext.orders.value[0])
queueContext.orders.value[0].paymentAmount = 999
queueContext.orders.value[0].delivery.paymentAmount = 999
const secondSave = queueContext.persistOrders(queueContext.orders.value[0])

firstResolve()
await firstSave
assert.equal(
  queuedCacheWrites.length,
  1,
  'first successful queued save must persist its confirmed snapshot even while another save is pending',
)
assert.equal(
  queuedCacheWrites[0][0].paymentAmount,
  10,
  'first successful queued save must not read the later dirty value',
)
assert.equal(
  queuedCacheWrites[0][0].delivery.paymentAmount,
  10,
  'nested confirmed payment must also come from the first immutable snapshot',
)

secondReject(new Error('second save failed'))
await assert.rejects(secondSave, /second save failed/)
assert.equal(
  queuedCacheWrites.length,
  1,
  'failed second queued save must not overwrite the last confirmed cache snapshot',
)
assert.equal(
  queuedCacheWrites[0][0].paymentAmount,
  10,
  'safe snapshot from the first success must survive a later queued failure',
)

{
  let resolveSave
  const saveGate = new Promise((resolve) => {
    resolveSave = resolve
  })
  const capturedWrites = []
  const orderA = structuredClone(validOrder)
  const orderB = structuredClone(validOrder)
  orderB.id = 2
  orderB.remoteId = 'remote-2'
  orderB.displayNumber = '2'
  orderB.paymentAmount = 20
  orderB.delivery.paymentAmount = 20
  const versionContext = {
    console,
    toRaw: (value) => value,
    isGuest: { value: false },
    user: { value: { id: 'user-1' } },
    orders: { value: [orderA, orderB] },
    editingOrderCell: { value: null },
    isPromRegistryDraft: { value: false },
    promRegistryOriginalFinancials: new Map(),
    pendingLocalOrderSaves: new Map(),
    deferredRemoteOrderIds: new Set(),
    remoteOrderVersions: new Map([
      ['remote-1', 'a-v1'],
      ['remote-2', 'b-v1'],
    ]),
    localRemoteOrderRevisions: new Map(),
    persistenceQueue: Promise.resolve(),
    queueRemoteOrderRefresh: () => {},
    writeRemoteOrdersSessionCache: (_userId, orders, versions) => {
      capturedWrites.push({
        orders: structuredClone(orders),
        versions: new Map(versions),
      })
    },
    persistOrdersNow: async (_savedOrders, localOrders) => {
      await saveGate
      return localOrders
    },
  }
  runInNewContext(
    ts.transpile(queueStatements.map((node) => node.getText(parsed)).join('\n'), {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    }),
    versionContext,
  )

  const save = versionContext.persistOrders(versionContext.orders.value[0])
  versionContext.orders.value[1].paymentAmount = 30
  versionContext.orders.value[1].delivery.paymentAmount = 30
  versionContext.remoteOrderVersions.set('remote-2', 'b-v2')
  resolveSave()
  await save

  assert.equal(capturedWrites.length, 1)
  assert.equal(
    capturedWrites[0].orders[1].paymentAmount,
    20,
    'save cache snapshot keeps unrelated order data from the same capture moment',
  )
  assert.equal(
    capturedWrites[0].versions.get('remote-2'),
    'b-v1',
    'save cache snapshot keeps versions from the same capture moment',
  )
}

function createQueueContext(persistOrdersNow) {
  const writes = []
  const order = structuredClone(validOrder)
  order.paymentAmount = 10
  order.delivery.paymentAmount = 10
  const value = {
    console,
    toRaw: (item) => item,
    isGuest: { value: false },
    user: { value: { id: 'user-1' } },
    orders: { value: [order] },
    editingOrderCell: { value: null },
    isPromRegistryDraft: { value: false },
    promRegistryOriginalFinancials: new Map(),
    pendingLocalOrderSaves: new Map(),
    deferredRemoteOrderIds: new Set(),
    remoteOrderVersions: new Map([['remote-1', 'server-v1']]),
    localRemoteOrderRevisions: new Map(),
    persistenceQueue: Promise.resolve(),
    queueRemoteOrderRefresh: () => {},
    writeRemoteOrdersSessionCache: (_userId, orders) => writes.push(structuredClone(orders)),
    persistOrdersNow,
  }
  runInNewContext(
    ts.transpile(queueStatements.map((node) => node.getText(parsed)).join('\n'), {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    }),
    value,
  )
  return { context: value, writes }
}

{
  const { context: dirtyContext, writes } = createQueueContext(async (_saved, localOrders) => localOrders)
  dirtyContext.editingOrderCell.value = 'other-order-payment'
  await dirtyContext.persistOrders(dirtyContext.orders.value[0])
  assert.equal(
    writes.length,
    0,
    'successful save must not cache a full snapshot captured while another inline edit is active',
  )
}

{
  const { context: successContext, writes } = createQueueContext(async (_saved, localOrders) => localOrders)
  const first = successContext.persistOrders(successContext.orders.value[0])
  successContext.orders.value[0].paymentAmount = 20
  successContext.orders.value[0].delivery.paymentAmount = 20
  const second = successContext.persistOrders(successContext.orders.value[0])
  await first
  await second
  assert.deepEqual(
    writes.map((orders) => orders[0].paymentAmount),
    [10, 20],
    'success then success must advance cache through both confirmed snapshots',
  )
}

{
  let call = 0
  const { context: recoveryContext, writes } = createQueueContext(async (_saved, localOrders) => {
    call += 1
    if (call === 1) throw new Error('first save failed')
    return localOrders
  })
  const first = recoveryContext.persistOrders(recoveryContext.orders.value[0])
  recoveryContext.orders.value[0].paymentAmount = 20
  recoveryContext.orders.value[0].delivery.paymentAmount = 20
  const second = recoveryContext.persistOrders(recoveryContext.orders.value[0])
  await assert.rejects(first, /first save failed/)
  await second
  assert.deepEqual(
    writes.map((orders) => orders[0].paymentAmount),
    [20],
    'failure then success must cache only the later confirmed snapshot',
  )
}

const actualSaveNames = [
  'persistConfirmedRemoteOrdersSessionCache',
  'orderWithRegistryFinancialsRestored',
  'incrementPendingLocalSaves',
  'decrementPendingLocalSaves',
  'persistOrders',
  'persistOrdersNow',
  'serializeOrder',
  'markRemoteOrderLocallyChanged',
  'cloneOrder',
]
const actualSaveStatements = parsed.statements.filter(
  (node) => ts.isFunctionDeclaration(node) && actualSaveNames.includes(node.name?.text),
)
assert.equal(
  actualSaveStatements.length,
  actualSaveNames.length,
  'actual save/cache helpers must remain extractable',
)

{
  const writes = []
  const newOrder = structuredClone(validOrder)
  delete newOrder.remoteId
  newOrder.id = 77
  newOrder.orderNumber = 77
  const actualContext = {
    console,
    toRaw: (value) => value,
    isGuest: { value: false },
    user: { value: { id: 'user-1' } },
    orders: { value: [newOrder] },
    editingOrderCell: { value: null },
    isPromRegistryDraft: { value: false },
    promRegistryOriginalFinancials: new Map(),
    pendingLocalOrderSaves: new Map(),
    deferredRemoteOrderIds: new Set(),
    remoteOrderVersions: new Map(),
    localRemoteOrderRevisions: new Map(),
    persistenceQueue: Promise.resolve(),
    queueRemoteOrderRefresh: () => {},
    writeRemoteOrdersSessionCache: (_userId, orders) => writes.push(structuredClone(orders)),
    storageKey: 'orders',
    window: {
      localStorage: {
        setItem: () => {},
      },
    },
    supabase: {
      functions: {
        invoke: async () => ({
          data: {
            ok: true,
            saved: [{ orderNumber: 77, remoteId: 'remote-new' }],
          },
          error: null,
        }),
      },
    },
    bankBalancesCard: { value: { refreshDebt: () => {} } },
  }
  runInNewContext(
    ts.transpile(actualSaveStatements.map((node) => node.getText(parsed)).join('\n'), {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    }),
    actualContext,
  )

  await actualContext.persistOrders(actualContext.orders.value[0])
  assert.equal(actualContext.orders.value[0].remoteId, 'remote-new', 'successful save assigns remoteId')
  assert.equal(writes.length, 1, 'successful new order save writes one confirmed cache snapshot')
  assert.equal(
    writes[0][0].remoteId,
    'remote-new',
    'new order enters confirmed cache with server-assigned remoteId',
  )
}

console.log(
  'Remote orders session cache: shape validation, v1 invalidation, preview safety and queued save snapshots OK',
)
