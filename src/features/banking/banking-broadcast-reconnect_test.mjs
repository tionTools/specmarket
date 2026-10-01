import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const monitorSource = readFileSync(new URL('./useBankingMonitor.ts', import.meta.url), 'utf8')
const cardSource = readFileSync(new URL('./BankBalancesCard.vue', import.meta.url), 'utf8')

const bankingTopicUses =
  (monitorSource.match(/channel\('crm:banking'/g) ?? []).length +
  (cardSource.match(/channel\('crm:banking'/g) ?? []).length

assert.equal(
  bankingTopicUses,
  1,
  'crm:banking must have exactly one frontend owner so the same RealtimeChannel is never subscribed twice',
)
assert.doesNotMatch(
  cardSource,
  /RealtimeChannel|\.channel\('crm:banking'/,
  'BankBalancesCard must not create or remove the shared banking channel',
)
assert.match(
  cardSource,
  /refreshJournal:\s*loadNovaPayJournal/,
  'BankBalancesCard must expose journal refresh to the shared banking monitor',
)

const executableSource = monitorSource
  .split('\n')
  .filter((line) => !line.startsWith('import '))
  .join('\n')
  .replace('export function useBankingMonitor', 'function useBankingMonitor')

const compiled = ts.transpile(executableSource, {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.None,
})

function ref(value) {
  return { value }
}

function computed(getter) {
  return Object.defineProperty({}, 'value', { get: getter })
}

const context = { ref, computed, console }
runInNewContext(compiled, context)
const { useBankingMonitor } = context
assert.equal(typeof useBankingMonitor, 'function')

class FakeChannel {
  constructor(topic) {
    this.topic = topic
    this.handlers = new Map()
    this.subscribeCalls = 0
    this.statusCallback = undefined
  }

  on(type, filter, callback) {
    assert.equal(type, 'broadcast')
    const event = filter.event
    const handlers = this.handlers.get(event) ?? []
    handlers.push(callback)
    this.handlers.set(event, handlers)
    return this
  }

  subscribe(callback) {
    this.subscribeCalls += 1
    if (this.subscribeCalls > 1) {
      throw new Error("Tried to subscribe multiple times. 'subscribe' can only be called a single time per channel instance")
    }
    this.statusCallback = callback
    return this
  }

  status(status) {
    this.statusCallback?.(status)
  }

  broadcast(event, payload = {}) {
    for (const callback of this.handlers.get(event) ?? []) callback({ payload })
  }
}

class Query {
  constructor(client, table) {
    this.client = client
    this.table = table
    this.gtValue = undefined
    this.ascending = true
  }

  select() {
    return this
  }

  in() {
    assert.equal(this.table, 'bank_account_cache')
    return Promise.resolve({ data: this.client.database.cacheRows, error: null })
  }

  gt(column, value) {
    assert.equal(column, 'id')
    this.gtValue = Number(value)
    return this
  }

  order(column, options) {
    assert.equal(column, 'id')
    this.ascending = options.ascending
    return this
  }

  limit(limit) {
    assert.equal(this.table, 'bank_payment_events')
    let rows = [...this.client.database.paymentRows]
    if (this.gtValue !== undefined) rows = rows.filter((row) => row.id > this.gtValue)
    rows.sort((left, right) => (this.ascending ? left.id - right.id : right.id - left.id))
    return Promise.resolve({ data: rows.slice(0, limit), error: null })
  }
}

class FakeSupabase {
  constructor(database) {
    this.database = database
    this.channels = new Map()
    this.channelCalls = 0
    this.removeCalls = 0
  }

  from(table) {
    return new Query(this, table)
  }

  channel(topic) {
    this.channelCalls += 1
    if (!this.channels.has(topic)) this.channels.set(topic, new FakeChannel(topic))
    return this.channels.get(topic)
  }

  removeChannel(channel) {
    this.removeCalls += 1
    this.channels.delete(channel.topic)
    return Promise.resolve('ok')
  }
}

function payment(id, amount) {
  return {
    id,
    bank: 'monobank',
    amount,
    payer: `payer-${id}`,
    description: `payment-${id}`,
    comment: '',
  }
}

function createBrowser(database) {
  const supabase = new FakeSupabase(database)
  const notifications = []
  let journalRefreshes = 0
  const visibility = ref('visible')
  const online = ref(true)
  const monitor = useBankingMonitor({
    supabase,
    user: ref({ id: crypto.randomUUID(), email: 'owner@example.com' }),
    isGuest: computed(() => false),
    isOnline: online,
    documentVisibility: visibility,
    onPayment: (event) => notifications.push(event),
    onJournalChange: () => {
      journalRefreshes += 1
    },
  })

  return {
    supabase,
    monitor,
    notifications,
    visibility,
    online,
    journalRefreshes: () => journalRefreshes,
    channel: () => supabase.channels.get('crm:banking'),
  }
}

async function settle() {
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await Promise.resolve()
}

const database = {
  cacheRows: [
    { bank: 'monobank', balance: 100, updated_at: '2026-10-01T12:00:00Z' },
    { bank: 'novapay', balance: 200, updated_at: '2026-10-01T12:00:00Z' },
  ],
  paymentRows: [payment(10, 100)],
}

const browserA = createBrowser(database)
const browserB = createBrowser(database)

await Promise.all([browserA.monitor.start(), browserB.monitor.start()])

assert.equal(browserA.supabase.channelCalls, 1)
assert.equal(browserB.supabase.channelCalls, 1)
assert.equal(browserA.channel().subscribeCalls, 1)
assert.equal(browserB.channel().subscribeCalls, 1)
assert.deepEqual(browserA.notifications, [])
assert.deepEqual(browserB.notifications, [])

// Both channels become live; existing payment id=10 is only the startup baseline.
browserA.channel().status('SUBSCRIBED')
browserB.channel().status('SUBSCRIBED')
await settle()
assert.deepEqual(browserA.notifications, [])
assert.deepEqual(browserB.notifications, [])

// Reproduce the production symptom: A receives the broadcast, B misses it entirely.
database.paymentRows.push(payment(11, 55))
browserA.channel().broadcast('bank_payment_inserted', { bank: 'monobank', amount: 55 })
await settle()

assert.equal(browserA.notifications.length, 1)
assert.equal(browserA.notifications[0].amount, 55)
assert.equal(browserB.notifications.length, 0)

// B later reconnects. SUBSCRIBED catch-up must replay the missed DB row without F5.
browserB.channel().status('SUBSCRIBED')
await settle()

assert.equal(browserB.notifications.length, 1)
assert.equal(browserB.notifications[0].amount, 55)

// Repeated SUBSCRIBED / duplicate broadcast must not replay the same payment twice.
browserB.channel().status('SUBSCRIBED')
browserB.channel().broadcast('bank_payment_inserted', { bank: 'monobank', amount: 55 })
await settle()
assert.equal(browserB.notifications.length, 1)

// A payment missed while a tab is backgrounded is caught when the tab becomes visible.
database.paymentRows.push(payment(12, 75))
browserB.visibility.value = 'hidden'
browserB.monitor.handleVisibilityChange()
await settle()
assert.equal(browserB.notifications.length, 1)

browserB.visibility.value = 'visible'
browserB.monitor.handleVisibilityChange()
await settle()
assert.equal(browserB.notifications.length, 2)
assert.equal(browserB.notifications[1].amount, 75)

// A missed event is also caught when the browser comes back online.
database.paymentRows.push(payment(13, 90))
browserA.online.value = false
browserA.monitor.handleOnline()
await settle()
assert.equal(browserA.notifications.length, 1)

browserA.online.value = true
browserA.monitor.handleOnline()
await settle()
assert.equal(browserA.notifications.length, 3)
assert.deepEqual(
  browserA.notifications.map((event) => event.amount),
  [55, 75, 90],
)

// Journal invalidation is owned by the same single channel.
const beforeJournal = browserA.journalRefreshes()
browserA.channel().broadcast('novapay_journal_changed')
assert.equal(browserA.journalRefreshes(), beforeJournal + 1)

browserA.monitor.stop()
browserB.monitor.stop()
assert.equal(browserA.supabase.removeCalls, 1)
assert.equal(browserB.supabase.removeCalls, 1)

console.log('Banking Broadcast reconnect/catch-up: OK')
