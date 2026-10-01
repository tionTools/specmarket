import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const homeSource = readFileSync(new URL('../../pages/HomeView.vue', import.meta.url), 'utf8')
const homeScript = homeSource.split('<script setup lang="ts">')[1].split('</script>')[0]
const parsed = ts.createSourceFile('HomeView.ts', homeScript, ts.ScriptTarget.Latest, true)

function extractFunctions(names) {
  const statements = parsed.statements.filter(
    (node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text),
  )
  assert.equal(statements.length, names.length, `Expected helpers: ${names.join(', ')}`)
  return ts.transpile(statements.map((node) => node.getText(parsed)).join('\n'), {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.None,
  })
}

const cacheBranchStart = homeScript.indexOf(
  'const cached = readRemoteOrdersSessionCache(session.session.user.id)',
)
const fullLoadStart = homeScript.indexOf(
  'const { rows: remoteOrders, error: ordersError } = await fetchAllRemoteOrderRows(supabase)',
)
assert.ok(
  cacheBranchStart >= 0 && fullLoadStart > cacheBranchStart,
  'cache branch must be locatable',
)
const cacheBranch = homeScript.slice(cacheBranchStart, fullLoadStart)

assert.match(
  cacheBranch,
  /startupCacheReconciliationPending = true[\s\S]*startAutomaticOrdersRefresh\(\)/,
  'cache hit must arm startup reconciliation and subscribe Realtime before catch-up',
)
assert.doesNotMatch(
  cacheBranch,
  /await reconcileRemoteOrders\(true\)/,
  'cache hit must not run a version scan before Realtime subscription',
)

const statusSource = extractFunctions(['handleOrdersRealtimeStatus'])

function makeStatusContext({ startupPending }) {
  const reconciliationCalls = []
  let reconnectCalls = 0
  const context = {
    ordersRealtimeSubscribed: { value: false },
    startupCacheReconciliationPending: startupPending,
    realtimeReconnectAttempt: 3,
    realtimeStatusDetail: { value: 'old' },
    realtimeReconnectTimer: undefined,
    window: { clearTimeout: () => {} },
    realtimeErrorMessage: (error) => (error instanceof Error ? error.message : ''),
    scheduleReconciliation: (delay, force) => reconciliationCalls.push([delay, force]),
    scheduleRealtimeReconnect: () => {
      reconnectCalls += 1
    },
  }
  runInNewContext(statusSource, context)
  return { context, reconciliationCalls, reconnectCalls: () => reconnectCalls }
}

// Normal cache-hit startup: no pre-subscribe scan, exactly one authoritative scan after SUBSCRIBED.
{
  const state = makeStatusContext({ startupPending: true })
  state.context.handleOrdersRealtimeStatus('SUBSCRIBED')
  assert.equal(state.context.startupCacheReconciliationPending, false)
  assert.equal(state.context.ordersRealtimeSubscribed.value, true)
  assert.equal(state.context.realtimeReconnectAttempt, 0)
  assert.equal(state.context.realtimeStatusDetail.value, '')
  assert.deepEqual(state.reconciliationCalls, [[0, true]])
  assert.equal(state.reconnectCalls(), 0)
}

// If initial Realtime subscription fails, stale cache still gets a fallback reconciliation.
{
  const state = makeStatusContext({ startupPending: true })
  state.context.handleOrdersRealtimeStatus('TIMED_OUT', new Error('timeout'))
  assert.equal(state.context.startupCacheReconciliationPending, false)
  assert.equal(state.context.ordersRealtimeSubscribed.value, false)
  assert.equal(state.context.realtimeStatusDetail.value, 'timeout')
  assert.deepEqual(state.reconciliationCalls, [[0, true]])
  assert.equal(state.reconnectCalls(), 1)
}

// Later connection errors do not add an extra fallback scan; reconnect remains responsible for catch-up.
{
  const state = makeStatusContext({ startupPending: false })
  state.context.handleOrdersRealtimeStatus('CHANNEL_ERROR', new Error('offline'))
  assert.deepEqual(state.reconciliationCalls, [])
  assert.equal(state.reconnectCalls(), 1)
}

// Every successful (re)subscription still schedules the normal gap-closing reconciliation.
{
  const state = makeStatusContext({ startupPending: false })
  state.context.handleOrdersRealtimeStatus('SUBSCRIBED')
  assert.deepEqual(state.reconciliationCalls, [[0, true]])
}

const reconcileSource = extractFunctions(['reconcileRemoteOrders'])

function deferred() {
  let resolve
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

// A forced catch-up requested while another version scan is running must be queued, not dropped.
{
  const gate = deferred()
  const scheduled = []
  let versionFetches = 0
  const context = {
    supabase: {},
    isReconciliationRunning: false,
    reconciliationRequestedWhileRunning: false,
    documentVisibility: { value: 'visible' },
    fetchAllRemoteOrderVersions: async () => {
      versionFetches += 1
      return gate.promise
    },
    orders: { value: [] },
    remoteOrderVersions: new Map(),
    removeRemoteOrder: () => {},
    refreshRemoteOrders: async () => true,
    lastReconciliationAt: 0,
    scheduleReconciliation: (delay, force) => scheduled.push([delay, force]),
    console,
  }
  runInNewContext(reconcileSource, context)

  const first = context.reconcileRemoteOrders(true)
  await Promise.resolve()
  assert.equal(context.isReconciliationRunning, true)
  assert.equal(versionFetches, 1)

  await context.reconcileRemoteOrders(true)
  assert.equal(
    context.reconciliationRequestedWhileRunning,
    true,
    'forced catch-up during an active scan must be remembered',
  )

  gate.resolve({ rows: [], error: null })
  await first

  assert.equal(context.isReconciliationRunning, false)
  assert.equal(context.reconciliationRequestedWhileRunning, false)
  assert.deepEqual(
    scheduled,
    [[0, true]],
    'remembered forced catch-up must be scheduled immediately after the active scan',
  )
}

// Non-forced noise during an active scan is still coalesced away.
{
  const gate = deferred()
  const scheduled = []
  const context = {
    supabase: {},
    isReconciliationRunning: false,
    reconciliationRequestedWhileRunning: false,
    documentVisibility: { value: 'visible' },
    fetchAllRemoteOrderVersions: async () => gate.promise,
    orders: { value: [] },
    remoteOrderVersions: new Map(),
    removeRemoteOrder: () => {},
    refreshRemoteOrders: async () => true,
    lastReconciliationAt: 0,
    scheduleReconciliation: (delay, force) => scheduled.push([delay, force]),
    console,
  }
  runInNewContext(reconcileSource, context)

  const first = context.reconcileRemoteOrders(true)
  await Promise.resolve()
  await context.reconcileRemoteOrders(false)
  gate.resolve({ rows: [], error: null })
  await first

  assert.deepEqual(scheduled, [], 'non-forced overlap should not create another version scan')
}

console.log('Remote orders startup reconciliation coalescing: OK')
