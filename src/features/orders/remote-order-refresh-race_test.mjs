import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const homeSource = readFileSync(new URL('../../pages/HomeView.vue', import.meta.url), 'utf8')
const homeScript = homeSource.split('<script setup lang="ts">')[1].split('</script>')[0]
const parsed = ts.createSourceFile('HomeView.ts', homeScript, ts.ScriptTarget.Latest, true)

const names = [
  'markRemoteOrderLocallyChanged',
  'remoteOrderLocalRevision',
  'refreshRemoteOrders',
]
const statements = parsed.statements.filter(
  (node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text),
)
assert.equal(statements.length, names.length, 'refresh race helpers must remain extractable')

assert.match(
  homeScript,
  /for \(const savedOrder of savedOrders\) markRemoteOrderLocallyChanged\(savedOrder\.remoteId\)/,
  'persistOrders must advance local revision before an async save',
)
assert.match(
  homeScript,
  /markRemoteOrderLocallyChanged\(order\?\.remoteId\)\s+editingOrderCell\.value = key/,
  'starting inline edit must advance local revision before yielding',
)

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function chunks(values, size) {
  const result = []
  for (let start = 0; start < values.length; start += size) {
    result.push(values.slice(start, start + size))
  }
  return result
}

function makeOrder(remoteId, customer) {
  return {
    id: remoteId,
    remoteId,
    customer,
    platform: 'Пром',
    products: [],
    delivery: {},
  }
}

function createContext({ requestedIds, orderRowsPromise, busyIds = new Set(), initialOrders }) {
  const queued = []
  const removed = []
  const registered = []
  const deferredRemoteOrderIds = new Set()
  const remoteOrderVersions = new Map()
  const localRemoteOrderRevisions = new Map()
  const orders = { value: initialOrders.map((order) => structuredClone(order)) }

  const context = {
    console,
    supabase: {
      from(table) {
        return {
          select() {
            return {
              in(_field, ids) {
                if (table === 'crm_orders') return orderRowsPromise(ids)
                if (table === 'crm_order_item_returns') {
                  return Promise.resolve({ data: [], error: null })
                }
                throw new Error(`Unexpected table: ${table}`)
              },
            }
          },
        }
      },
    },
    chunks,
    targetedOrdersBatchSize: 100,
    deferredRemoteOrderIds,
    localRemoteOrderRevisions,
    remoteOrderVersions,
    isRemoteOrderLocallyBusy: (remoteId) => busyIds.has(remoteId),
    queueRemoteOrderRefresh: (remoteId) => queued.push(remoteId),
    mapRemoteOrders: (rows) =>
      rows.map((row) => makeOrder(String(row.id), String(row.customer ?? 'server'))),
    removeRemoteOrder: (remoteId) => {
      removed.push(remoteId)
      orders.value = orders.value.filter((order) => order.remoteId !== remoteId)
    },
    orders,
    pendingNewOrderIds: new Set(),
    notifyNewOrder: () => {},
    registerRefreshedRemoteOrders: (rows) => registered.push(...rows),
    isPromRegistryDraft: { value: false },
    promRegistryEntries: { value: [] },
    applyPromRegistryPreview: () => {},
    reapplyRegistryPreview: () => {},
    sortOrders: () => {},
    reconcileLabelReminders: () => {},
    persistRemoteOrdersSessionCache: () => {},
    bankBalancesCard: { value: { refreshDebt: () => {} } },
  }

  runInNewContext(
    ts.transpile(statements.map((node) => node.getText(parsed)).join('\n'), {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    }),
    context,
  )

  return {
    context,
    requestedIds,
    queued,
    removed,
    registered,
    deferredRemoteOrderIds,
    remoteOrderVersions,
    localRemoteOrderRevisions,
    orders,
    busyIds,
  }
}

// M2: request starts while clean. Local edit + successful save complete before stale response returns.
// Busy is false at apply time, so only the revision guard can protect the local value.
{
  const gate = deferred()
  const state = createContext({
    requestedIds: ['r1'],
    initialOrders: [makeOrder('r1', 'before')],
    orderRowsPromise: () => gate.promise,
  })

  const refresh = state.context.refreshRemoteOrders(state.requestedIds)
  await Promise.resolve()

  state.orders.value[0].customer = 'local-saved'
  state.context.markRemoteOrderLocallyChanged('r1')
  gate.resolve({
    data: [{ id: 'r1', updated_at: 'server-v1', customer: 'stale-server' }],
    error: null,
  })

  assert.equal(await refresh, false, 'stale refresh is not reported as fully applied')
  assert.equal(
    state.orders.value[0].customer,
    'local-saved',
    'stale server row must not overwrite a local edit that started after request launch',
  )
  assert.equal(
    state.remoteOrderVersions.has('r1'),
    false,
    'skipped stale row must not mark its server version fresh',
  )
  assert.deepEqual(state.queued, ['r1'], 'clean-after-save stale row must schedule a fresh targeted read')
  assert.equal(state.deferredRemoteOrderIds.has('r1'), false)
}

// If the edit/save is still busy when the response arrives, keep the ID deferred instead of applying it.
{
  const gate = deferred()
  const busyIds = new Set()
  const state = createContext({
    requestedIds: ['r1'],
    initialOrders: [makeOrder('r1', 'before')],
    busyIds,
    orderRowsPromise: () => gate.promise,
  })

  const refresh = state.context.refreshRemoteOrders(state.requestedIds)
  await Promise.resolve()

  state.orders.value[0].customer = 'local-dirty'
  state.context.markRemoteOrderLocallyChanged('r1')
  busyIds.add('r1')
  gate.resolve({
    data: [{ id: 'r1', updated_at: 'server-v1', customer: 'stale-server' }],
    error: null,
  })

  assert.equal(await refresh, false)
  assert.equal(state.orders.value[0].customer, 'local-dirty')
  assert.equal(state.remoteOrderVersions.has('r1'), false)
  assert.equal(state.deferredRemoteOrderIds.has('r1'), true)
  assert.deepEqual(state.queued, [], 'busy order waits for existing deferred-save/edit flush')
}

// Clean rows in the same batch still apply; stale edited rows are skipped independently.
{
  const state = createContext({
    requestedIds: ['r1', 'r2'],
    initialOrders: [makeOrder('r1', 'local-r1'), makeOrder('r2', 'old-r2')],
    orderRowsPromise: () =>
      Promise.resolve({
        data: [
          { id: 'r1', updated_at: 'r1-v2', customer: 'stale-r1' },
          { id: 'r2', updated_at: 'r2-v2', customer: 'fresh-r2' },
        ],
        error: null,
      }),
  })

  state.context.markRemoteOrderLocallyChanged('r1')
  const refreshPromise = state.context.refreshRemoteOrders(state.requestedIds)
  // Change r1 again after the request snapshot but before apply.
  state.context.markRemoteOrderLocallyChanged('r1')

  assert.equal(await refreshPromise, false)
  assert.equal(state.orders.value.find((order) => order.remoteId === 'r1').customer, 'local-r1')
  assert.equal(state.orders.value.find((order) => order.remoteId === 'r2').customer, 'fresh-r2')
  assert.equal(state.remoteOrderVersions.has('r1'), false)
  assert.equal(state.remoteOrderVersions.get('r2'), 'r2-v2')
  assert.deepEqual(state.queued, ['r1'])
}

// Normal no-race targeted refresh behavior remains unchanged.
{
  const state = createContext({
    requestedIds: ['r1'],
    initialOrders: [makeOrder('r1', 'old')],
    orderRowsPromise: () =>
      Promise.resolve({
        data: [{ id: 'r1', updated_at: 'server-v2', customer: 'fresh-server' }],
        error: null,
      }),
  })

  assert.equal(await state.context.refreshRemoteOrders(state.requestedIds), true)
  assert.equal(state.orders.value[0].customer, 'fresh-server')
  assert.equal(state.remoteOrderVersions.get('r1'), 'server-v2')
  assert.deepEqual(state.queued, [])
}

console.log('Remote order refresh race guard: OK')
