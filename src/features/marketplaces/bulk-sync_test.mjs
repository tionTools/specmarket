import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const home = readFileSync(new URL('../../pages/HomeView.vue', import.meta.url), 'utf8')
const script = home.slice(
  home.indexOf('<script setup lang="ts">') + '<script setup lang="ts">'.length,
  home.indexOf('</script>'),
)
const parsed = ts.createSourceFile('HomeView.ts', script, ts.ScriptTarget.Latest, true)
const names = ['loadEnabledBulkMarketplaces', 'syncNewAllPlatforms', 'syncFullAllPlatforms']
const statements = parsed.statements.filter(
  (node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text),
)
assert.equal(statements.length, names.length, 'test actual bulk sync functions from HomeView')

const calls = []
const notices = []
let rows = [
  { platform: 'Эпицентр', enabled: true },
  { platform: 'Пром', enabled: true },
  { platform: 'Каста', enabled: false },
]
let settingsError = null
const isSyncingAllPlatforms = { value: false }
const context = {
  supabase: {
    from(table) {
      assert.equal(table, 'crm_marketplace_settings')
      return {
        async select(columns) {
          assert.equal(columns, 'platform, enabled')
          return { data: rows, error: settingsError }
        },
      }
    },
  },
  marketplaceEnabledFromRows(value) {
    const enabled = {}
    for (const platform of ['Эпицентр', 'Пром', 'Каста']) {
      const row = value.find((item) => item.platform === platform)
      if (!row || typeof row.enabled !== 'boolean') throw new Error('Incomplete marketplace settings')
      enabled[platform] = row.enabled
    }
    return enabled
  },
  isMarketplaceSyncBusy: { value: false },
  isGuest: { value: false },
  isSyncingAllPlatforms,
  syncEpicentrOrders: async (full, results) => { calls.push(['Эпицентр', full]); results.push('Эпицентр: ok') },
  syncPromOrders: async (full, results) => { calls.push(['Пром', full]); results.push('Prom: ok') },
  syncKastaOrders: async (full, results) => { calls.push(['Каста', full]); results.push('Каста: ok') },
  showSyncMessage: (message) => notices.push(['message', message]),
  showSyncError: (message) => notices.push(['error', message]),
  window: { confirm: () => true },
}
runInNewContext(
  ts.transpile(statements.map((node) => node.getText(parsed)).join('\n'), {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.None,
  }) + '\nthis.fixture = { syncNewAllPlatforms, syncFullAllPlatforms }',
  context,
)
const { syncNewAllPlatforms, syncFullAllPlatforms } = context.fixture

await syncNewAllPlatforms()
assert.equal(calls.map((x) => x[0]).join(','), 'Эпицентр,Пром', 'paused Kasta must not be invoked at all')
assert.equal(isSyncingAllPlatforms.value, false)

calls.length = 0
await syncFullAllPlatforms()
assert.equal(calls.map((x) => x[0]).join(','), 'Эпицентр,Пром', 'full sync must skip paused Kasta')
assert(calls.every((x) => x[1] === true))

calls.length = 0
rows = rows.map((row) => ({ ...row, enabled: false }))
await syncNewAllPlatforms()
assert.equal(calls.length, 0, 'all-paused new sync must invoke no functions')
await syncFullAllPlatforms()
assert.equal(calls.length, 0, 'all-paused full sync must invoke no functions')

calls.length = 0
rows = [
  { platform: 'Эпицентр', enabled: false },
  { platform: 'Пром', enabled: false },
  { platform: 'Каста', enabled: true },
]
await syncNewAllPlatforms()
assert.equal(calls.map((x) => x[0]).join(','), 'Каста', 're-enabled Kasta must sync normally')

calls.length = 0
settingsError = { message: 'database unavailable' }
await syncNewAllPlatforms()
assert.equal(calls.length, 0, 'settings error must abort every bulk request')
assert.equal(notices.at(-1)[0], 'error')
settingsError = null
rows = [{ platform: 'Каста', enabled: false }]
await syncFullAllPlatforms()
assert.equal(calls.length, 0, 'missing settings must abort every bulk request')
assert.equal(isSyncingAllPlatforms.value, false)
console.log('Bulk marketplace sync: paused platforms are never invoked; enabled and fail-closed paths PASS')
