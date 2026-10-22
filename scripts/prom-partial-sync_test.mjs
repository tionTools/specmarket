import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { FunctionsHttpError } from '@supabase/supabase-js'
import ts from 'typescript'

const source = readFileSync(new URL('../src/pages/HomeView.vue', import.meta.url), 'utf8')
const script = source.split('<script setup lang="ts">')[1].split('</script>')[0]
const parsed = ts.createSourceFile('HomeView.ts', script, ts.ScriptTarget.Latest, true)
const declaration = parsed.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'syncPromOrders',
)
assert.ok(declaration)
const code = ts.transpile(declaration.getText(parsed), { target: ts.ScriptTarget.ES2022 })

async function run(error, summary) {
  const refreshed = []
  const warnings = []
  const successes = []
  const sync = runInNewContext(`${code}; syncPromOrders`, {
    FunctionsHttpError,
    Response,
    supabase: { functions: { invoke: async () => ({ data: null, error }) } },
    isGuest: { value: false },
    isSyncingProm: { value: false },
    syncEpicentrMessage: { value: '' },
    waitForPendingSaves: async () => true,
    refreshOrdersAfterMarketplaceSync: async ({ changedOrderIds }) => {
      refreshed.push(...changedOrderIds)
      warnings.length = 0
    },
    showSyncError: (message) => warnings.push(message),
    showSyncMessage: (message) => successes.push(message),
  })
  await sync(false, summary)
  return { refreshed, warnings, successes }
}

const partial = {
  ok: false,
  code: 'INVALID_ORDER_ITEMS',
  failed: 2,
  changedOrderIds: ['order-1', 'order-2', 'order-1'],
}
const httpError = (body, status = 502) => new FunctionsHttpError(Response.json(body, { status }))

test('Prom partial HTTP failure refreshes only saved orders and retains warning', async () => {
  for (const summary of [undefined, []]) {
    const error = httpError(partial)
    const result = await run(error, summary)
    assert.deepEqual(result.refreshed, ['order-1', 'order-2'])
    assert.equal(result.successes.length, 0)
    const messages = summary ?? result.warnings
    assert.equal(messages.length, 1)
    assert.match(messages[0], /: ошибка — частичная синхронизация/)
    assert.match(messages[0], /успешно изменено 2, отклонено 2/)
    assert.equal(error.context.bodyUsed, false)
  }
})

test('Prom unconfirmed or empty partial results keep ordinary error without refresh', async () => {
  const consumed = httpError(partial)
  await consumed.context.json()
  for (const error of [
    httpError({ ...partial, changedOrderIds: [] }),
    httpError({ ...partial, changedOrderIds: ['order-1', null] }),
    httpError({ ...partial, changedOrderIds: [''] }),
    httpError({ ...partial, changedOrderIds: undefined }),
    httpError({ ...partial, failed: 0 }),
    httpError({ ...partial, code: 'OTHER_ERROR' }),
    httpError(partial, 500),
    new FunctionsHttpError(new Response('{', { status: 502 })),
    consumed,
    new Error('Network failure'),
  ]) {
    const result = await run(error)
    assert.deepEqual(result.refreshed, [])
    assert.deepEqual(result.successes, [])
    assert.deepEqual(result.warnings, [error.message])
  }
})
