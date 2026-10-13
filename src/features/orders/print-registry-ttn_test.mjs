import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const home = readFileSync(new URL('../../pages/HomeView.vue', import.meta.url), 'utf8')
const script = home.split('<script setup lang="ts">')[1].split('</script>')[0]
const parsed = ts.createSourceFile('HomeView.ts', script, ts.ScriptTarget.Latest, true)
const names = [
  'eligiblePrintRegistryOrders',
  'missingPrintRegistryTtnOrders',
  'missingPrintRegistryTtnCount',
  'hasNewPrintRegistryOrders',
  'openPrintRegistry',
  'currentPrintRegistry',
  'refreshPrintRegistry',
  'checkPrintRegistryTtn',
  'closePrintRegistry',
  'savePrintState',
  'showPrintRegistryHistory',
  'showCurrentPrintRegistry',
]
const statements = parsed.statements.filter(
  (node) =>
    (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) ||
    (ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(
        (declaration) => ts.isIdentifier(declaration.name) && names.includes(declaration.name.text),
      )),
)
assert.equal(statements.length, names.length, 'execute the actual registry functions')
const code = ts.transpile(statements.map((node) => node.getText(parsed)).join('\n'), {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.None,
})

function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function order(number, ttn = '') {
  return {
    id: number,
    remoteId: `remote-${number}`,
    externalId: `external-${number}`,
    platform: 'Пром',
    delivery: { ttn },
  }
}

async function settle() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

function fixture(initialOrders, invoke, readback = async () => true) {
  const errors = []
  const calls = []
  const timeouts = []
  const state = {
    orders: { value: initialOrders },
    printRegistryMode: { value: null },
    printRegistryOrderIds: { value: [] },
    isPreparingPrintRegistry: { value: false },
    isCheckingRegistryTtn: { value: false },
    isUpdatingPrintRegistry: { value: false },
    registryTtnProgress: { value: { checked: 0, total: 0 } },
    registryTtnMessage: { value: '' },
    isGuest: { value: false },
  }
  let clock = 0
  class TestDate extends Date {
    static now() {
      return clock
    }
  }
  const context = {
    ...state,
    AbortController,
    AbortSignal: {
      any: (signals) => AbortSignal.any(signals),
      timeout: (milliseconds) => {
        timeouts.push(milliseconds)
        return AbortSignal.timeout(milliseconds)
      },
    },
    Date: TestDate,
    window: { localStorage: { setItem() {} } },
    storageKey: 'test',
    supabase: {
      functions: {
        invoke: async (name, options) => {
          calls.push({ name, options })
          return invoke(name, options)
        },
      },
    },
    computed: (calculate) => ({
      get value() {
        return calculate()
      },
    }),
    waitForPendingSaves: async () => true,
    isOpenForPrintRegistry: () => true,
    orderSyncSnapshot: (item) => item,
    orderWithRegistryFinancialsRestored: (item) => item,
    refreshRemoteOrders: async (...args) => readback(...args),
    showSyncError: (message) => errors.push(message),
  }
  runInNewContext(
    `let printRegistryGeneration = 0; let registryTtnController = null;\n${code}\nthis.registry = { ${names.join(', ')} }`,
    context,
  )
  return {
    ...state,
    ...context.registry,
    calls,
    errors,
    timeouts,
    setClock: (value) => {
      clock = value
    },
  }
}

{
  const rows = Array.from({ length: 9 }, (_, index) => order(index + 1))
  let readbackIds
  const f = fixture(
    rows,
    async (_name, options) => {
      const id = Number(options.body.externalId.slice(9))
      if (id === 4) f.setClock(31_000)
      if (id === 1 || id === 2)
        return { data: { ok: true, changedOrderIds: [`changed-${id}`] }, error: null }
      if (id === 3) return { data: null, error: new Error('network') }
      throw new Error('timeout')
    },
    async (ids, _signal, preserveMissing) => {
      readbackIds = [...ids]
      assert.equal(preserveMissing, true)
      return true
    },
  )
  f.openPrintRegistry()
  assert.equal(f.printRegistryMode.value, 'draft', 'modal opens before any request')
  assert.equal(f.calls.length, 0, 'no API request before showing modal')
  await settle()
  await f.checkPrintRegistryTtn()
  assert.equal(f.calls.length, 4, 'deadline prevents the second batch')
  assert.deepEqual(readbackIds, ['remote-1', 'remote-2', 'changed-1', 'changed-2'])
  assert.equal(f.registryTtnProgress.value.checked, 4)
  assert.match(f.registryTtnMessage.value, /Не проверено: 5/)
  assert.equal(f.printRegistryOrderIds.value.length, 0, 'new orders are not silently added')
  assert.ok(f.timeouts.includes(15_000), 'readback has a 15-second deadline')
}

{
  const f = fixture(
    Array.from({ length: 10 }, (_, index) => order(index + 1)),
    async () => ({ data: { ok: false }, error: null }),
    async () => {
      throw new Error('readback must not run')
    },
  )
  f.openPrintRegistry()
  await settle()
  await f.checkPrintRegistryTtn()
  assert.equal(f.calls.length, 10)
  assert.equal(f.registryTtnProgress.value.checked, 10)
}

{
  const f = fixture(
    Array.from({ length: 50 }, (_, index) => order(index + 1)),
    async () => ({ data: { ok: false }, error: null }),
    async () => {
      throw new Error('readback must not run')
    },
  )
  f.openPrintRegistry()
  await settle()
  await f.checkPrintRegistryTtn()
  assert.equal(f.calls.length, 50)
  assert.equal(f.registryTtnProgress.value.checked, 50)
}

{
  const pending = deferred()
  let oldRun = true
  const f = fixture([order(1)], async () =>
    oldRun ? pending.promise : { data: { ok: true }, error: null },
  )
  f.openPrintRegistry()
  await settle()
  const oldCheck = f.checkPrintRegistryTtn()
  await settle()
  assert.equal(f.isCheckingRegistryTtn.value, true)
  f.closePrintRegistry()
  oldRun = false
  f.openPrintRegistry()
  await settle()
  pending.resolve({ data: { ok: true, changedOrderIds: ['stale'] }, error: null })
  await oldCheck
  assert.equal(f.registryTtnProgress.value.checked, 0)
  assert.equal(f.registryTtnMessage.value, '')
  assert.equal(f.printRegistryOrderIds.value.length, 0)
  assert.equal(f.isCheckingRegistryTtn.value, false)
}

{
  const item = order(1, 'TTN')
  const f = fixture([item], async () => ({ data: null, error: new Error('save failed') }))
  f.openPrintRegistry()
  await settle()
  assert.equal(item.delivery.printCheckedAt, undefined, 'failed save does not create a local check')
  assert.match(f.registryTtnMessage.value, /Не удалось подтвердить сохранение/)
  assert.equal(f.isPreparingPrintRegistry.value, false)
  assert.ok(f.timeouts.includes(20_000), 'print state has a 20-second deadline')
}

{
  const pending = deferred()
  const item = order(1, 'TTN')
  const f = fixture([item], async () => pending.promise)
  f.openPrintRegistry()
  await settle()
  f.closePrintRegistry()
  assert.equal(f.printRegistryMode.value, 'draft', 'close is blocked during print-state save')
  pending.resolve({ data: { ok: true }, error: null })
  await settle()
  assert.ok(item.delivery.printCheckedAt, 'successful save updates the local check')
  assert.equal(item.delivery.printedAt, undefined, 'check is not a printed mark')
  f.showPrintRegistryHistory()
  assert.equal(f.printRegistryMode.value, 'history')
  f.showCurrentPrintRegistry()
  assert.equal(f.printRegistryMode.value, 'draft')
  f.closePrintRegistry()
  assert.equal(f.printRegistryMode.value, null)
}

console.log(
  'Print registry TTN: 10/50 orders, partial batch, deadline, stale run, checked/printed, failed save PASS',
)
