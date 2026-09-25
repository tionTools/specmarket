import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const home = readFileSync(new URL('../../pages/HomeView.vue', import.meta.url), 'utf8')
const start = home.indexOf('async function syncNewAllPlatforms() {')
const end = home.indexOf('async function syncFullAllPlatforms() {', start)
assert.ok(start >= 0 && end > start, 'new orders sync handler exists')
const handler = home.slice(start, end)

assert.match(handler, /const syncResults: string\[\] = \[\]/)
for (const platform of ['Epicentr', 'Prom', 'Kasta']) {
  assert.ok(
    handler.includes(`await sync${platform}Orders(false, syncResults)`),
    platform + ' participates in aggregate result',
  )
}
assert.ok(
  handler.indexOf('await syncEpicentrOrders(false, syncResults)') <
    handler.indexOf('await syncPromOrders(false, syncResults)') &&
    handler.indexOf('await syncPromOrders(false, syncResults)') <
      handler.indexOf('await syncKastaOrders(false, syncResults)'),
  'all three platforms run before summary',
)
assert.match(handler, /const summary = syncResults\.join\('\\n'\)/)
assert.match(handler, /syncResults\.some\(\(result\) => result\.includes\(': ошибка — '\)\)/)
assert.match(handler, /showSyncError\(summary\)/)
assert.match(handler, /showSyncMessage\(summary\)/)
assert.equal(
  (handler.match(/showSyncMessage\(summary\)/g) ?? []).length,
  1,
  'one success summary, not last platform result',
)
console.log('New-orders sync summary: all three platforms, single summary, persistent errors PASS')
