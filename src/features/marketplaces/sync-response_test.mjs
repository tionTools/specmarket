import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

const home = readFileSync(new URL('../../pages/HomeView.vue', import.meta.url), 'utf8')
const script = home.slice(
  home.indexOf('<script setup lang="ts">') + '<script setup lang="ts">'.length,
  home.indexOf('</script>'),
)
const source = ts.createSourceFile('HomeView.ts', script, ts.ScriptTarget.Latest, true)

function extractFunctions(names, context) {
  const declarations = source.statements.filter(
    (node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text),
  )
  assert.equal(declarations.length, names.length, 'execute the actual HomeView functions')
  const code = ts.transpile(
    declarations.map((declaration) => declaration.getText(source)).join('\n'),
    { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  )
  runInNewContext(`${code}\nthis.fixture = { ${names.join(', ')} }`, context)
  return context.fixture
}

for (const [name, fn, platform] of [
  ['Prom', 'syncPromOrders', 'sync-prom-orders'],
  ['Epicentr', 'syncEpicentrOrders', 'sync-epicentr-orders'],
]) {
  await test(`${name}: numeric skipped is success and triggers refresh`, async () => {
    const notices = []
    const refreshed = []
    const context = {
      supabase: { functions: { invoke: async (requested) => {
        assert.equal(requested, platform)
        return { data: { ok: true, received: 4, created: 1, updated: 0, skipped: 3, changedOrderIds: ['new-order'] }, error: null }
      } } },
      isGuest: { value: false },
      isSyncingProm: { value: false },
      isSyncingEpicentr: { value: false },
      syncEpicentrMessage: { value: '' },
      waitForPendingSaves: async () => true,
      showSyncError: (message) => notices.push(['error', message]),
      showSyncMessage: (message) => notices.push(['success', message]),
      refreshOrdersAfterMarketplaceSync: async (data) => refreshed.push(data),
    }
    const handlers = extractFunctions([fn], context)
    await handlers[fn]()
    assert.equal(notices.length, 1)
    assert.equal(notices[0][0], 'success')
    assert.equal(refreshed.length, 1)
    assert.equal(refreshed[0].changedOrderIds[0], 'new-order')
  })

  await test(`${name}: only explicit paused marker is a pause`, async () => {
    const notices = []
    let refreshes = 0
    const context = {
      supabase: { functions: { invoke: async () => ({ data: { ok: true, skipped: 'paused' }, error: null }) } },
      isGuest: { value: false },
      isSyncingProm: { value: false },
      isSyncingEpicentr: { value: false },
      syncEpicentrMessage: { value: '' },
      waitForPendingSaves: async () => true,
      showSyncError: (message) => notices.push(['error', message]),
      showSyncMessage: (message) => notices.push(['success', message]),
      refreshOrdersAfterMarketplaceSync: async () => { refreshes += 1 },
    }
    const handlers = extractFunctions([fn], context)
    await handlers[fn]()
    assert.equal(notices.length, 1)
    assert.equal(notices[0][0], 'error')
    assert.match(notices[0][1], /паузе/)
    assert.equal(refreshes, 0)
  })
}

await test('explicit sync refreshes changed orders even when realtime is subscribed', async () => {
  const reloaded = []
  const reconciled = []
  const context = {
    refreshRemoteOrders: async (ids) => { reloaded.push([...ids]); return true },
    reconcileRemoteOrders: async (force) => { reconciled.push(force) },
    refreshLinkedPriceProductKeys: async () => {},
    reapplyRegistryPreview: () => {},
    isPromRegistryDraft: { value: false },
    promRegistryEntries: { value: [] },
    applyPromRegistryPreview: () => {},
    ordersRealtimeSubscribed: { value: true },
  }
  const { refreshOrdersAfterMarketplaceSync } = extractFunctions(['refreshOrdersAfterMarketplaceSync'], context)
  await refreshOrdersAfterMarketplaceSync({ changedOrderIds: ['new-order'] })
  assert.equal(reloaded.length, 1)
  assert.equal(reloaded[0].join(','), 'new-order')
  assert.equal(reconciled.length, 0)

  await refreshOrdersAfterMarketplaceSync({ changedOrderIds: [] })
  assert.equal(reconciled.length, 1)
  assert.equal(reconciled[0], true)

  await refreshOrdersAfterMarketplaceSync({})
  assert.equal(reconciled.length, 2)
  assert.equal(reconciled[1], true)
})
