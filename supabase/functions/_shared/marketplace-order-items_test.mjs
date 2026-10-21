import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

const root = fileURLToPath(new URL('../', import.meta.url))
const copy = (value) => JSON.parse(JSON.stringify(value))

// Execute the real handlers and local imports; all network/database boundaries are in memory.
function harness(platform, targeted) {
  const isProm = platform === 'Prom'
  const externalId = isProm ? 'prom:42' : '42'
  const tables = { crm_orders: [], crm_order_items: [], crm_marketplace_order_sync_state: [] }
  const writes = []
  let handler
  let responseOrders
  let detailOrder
  let details
  let malformedList = false
  let invalidJson = false
  const admin = {
    auth: { getUser: async () => ({ data: { user: { email: 'test@example.invalid' } } }) },
    from(table) {
      let operation = 'select'
      let values
      let single = false
      const filters = []
      const query = {
        select: () => query,
        order: () => query,
        in: (key, values) => {
          filters.push((row) => values.includes(row[key]))
          return query
        },
        eq: (key, value) => {
          filters.push((row) => row[key] === value)
          return query
        },
        maybeSingle: () => {
          single = true
          return query
        },
        single: () => {
          single = true
          return query
        },
        insert: (data) => {
          operation = 'insert'
          values = data
          return query
        },
        upsert: (data) => {
          operation = 'upsert'
          values = data
          return query
        },
        update: (data) => {
          operation = 'update'
          values = data
          return query
        },
        // Supabase query builders intentionally execute when awaited.
        // oxlint-disable-next-line unicorn/no-thenable
        then(onFulfilled, onRejected) {
          let result = (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)))
          if (operation !== 'select') {
            writes.push({ table, operation, values: copy(values) })
            if (table === 'crm_orders' && operation === 'insert') {
              const row = { ...copy(values), id: `order-${tables.crm_orders.length}` }
              tables.crm_orders.push(row)
              result = [row]
            } else if (table === 'crm_marketplace_order_sync_state') {
              const previous = tables[table].find((row) => row.external_id === values.external_id)
              if (previous) Object.assign(previous, copy(values))
              else tables[table].push(copy(values))
            }
          }
          return Promise.resolve({
            data: copy(single ? (result[0] ?? null) : result),
            error: null,
          }).then(onFulfilled, onRejected)
        },
      }
      return query
    },
    async rpc(name, args) {
      if (name === 'get_crm_marketplace_sync_access')
        return { data: { enabled: true, secret: 'scheduled' }, error: null }
      if (name === 'get_crm_marketplace_order_sync_context')
        return { data: copy(tables.crm_marketplace_order_sync_state), error: null }
      writes.push({ name, args: copy(args) })
      if (name === 'apply_crm_marketplace_order_snapshot') {
        const row = tables.crm_orders.find((row) => row.id === args.p_order_id)
        Object.assign(row, copy(args.p_data))
        return { data: true, error: null }
      }
      if (name === 'replace_crm_order_items') {
        tables.crm_order_items = tables.crm_order_items
          .filter((row) => row.order_id !== args.p_order_id)
          .concat(copy(args.p_items))
        return { data: null, error: null }
      }
      throw new Error(`Unexpected RPC: ${name}`)
    },
  }
  const modules = new Map()
  function load(path) {
    if (modules.has(path)) return modules.get(path)
    const exports = {}
    modules.set(path, exports)
    const source = readFileSync(path, 'utf8')
    runInNewContext(
      ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }),
      {
        exports,
        require: (specifier) => {
          if (specifier === 'https://esm.sh/@supabase/supabase-js@2')
            return { createClient: () => admin }
          assert.ok(specifier.startsWith('.'), `No external imports: ${specifier}`)
          return load(resolve(dirname(path), specifier))
        },
        Deno: {
          env: { get: (key) => (key.endsWith('FEED_URL') ? undefined : 'test-only') },
          serve: (callback) => {
            handler = callback
          },
        },
        fetch: async (url) => {
          if (invalidJson)
            return new Response('{', { headers: { 'Content-Type': 'application/json' } })
          if (String(url).includes('/orders/list?') || String(url).endsWith('/v4/oms/orders'))
            return Response.json(
              malformedList ? {} : isProm ? { orders: responseOrders } : { items: responseOrders },
            )
          if (String(url).includes('/orders/')) {
            const detail = details?.[String(url).split('/').at(-1)] ?? detailOrder
            return Response.json(isProm ? { order: detail } : detail)
          }
          throw new Error(`Unexpected network request: ${url}`)
        },
        Response,
        Request,
        TextEncoder,
        crypto,
        URL,
        console,
      },
      { filename: path },
    )
    return exports
  }
  load(resolve(root, isProm ? 'sync-prom-orders/index.ts' : 'sync-epicentr-orders/index.ts'))
  const line = (name, quantity = 2, price = 100) =>
    isProm
      ? { name, quantity, price: String(price), sku: name, size: 'M' }
      : { title: name, quantity, price, offerId: name }
  const order = (items) => {
    const data = isProm
      ? {
          id: 42,
          date_created: '2026-10-20T12:00:00Z',
          status: 'pending',
          client_first_name: 'Test',
        }
      : {
          id: '42',
          number: '42',
          createdAt: '2026-10-20T12:00:00Z',
          statusCode: 'new',
          subtotal: 400,
        }
    if (items !== undefined) data[isProm ? 'products' : 'items'] = items
    return data
  }
  const orderWrites = () =>
    writes.filter((write) => write.name || Object.hasOwn(tables, write.table))
  return {
    tables,
    writes,
    line,
    order,
    orderWrites,
    validator: load(resolve(root, '_shared/marketplace-order-items.ts')).validatedOrderItems,
    async run(items, options = {}) {
      detailOrder = options.detail ?? order(items)
      details = options.details
      responseOrders = options.orders ?? [order(items)]
      malformedList = options.malformedList ?? false
      invalidJson = options.invalidJson ?? false
      const body = targeted ? { externalId } : { scheduled: true }
      const response = await handler(
        new Request('https://test.invalid/sync', {
          method: 'POST',
          headers: { Authorization: targeted ? 'Bearer user' : 'Bearer scheduled' },
          body: JSON.stringify(body),
        }),
      )
      return { status: response.status, body: await response.json() }
    },
  }
}

for (const platform of ['Prom', 'Epicentr']) {
  for (const targeted of [true, false]) {
    const mode = targeted ? 'targeted' : 'scheduled'
    test(`${platform} ${mode}: valid composition updates and repeat`, async () => {
      const f = harness(platform, targeted)
      const scenarios = [
        [f.line('A'), f.line('B')],
        [f.line('A', 3, 125), f.line('B')],
        [f.line('A', 3, 125), f.line('B'), f.line('C')],
        // The fixture is explicitly complete. This does not prove completeness of a real API response.
        [f.line('B'), f.line('C')],
        [f.line('B', 2, 0), f.line('C')],
      ]
      for (const items of scenarios) {
        const result = await f.run(items)
        assert.equal(result.body.ok, true, JSON.stringify(result))
        assert.equal(f.tables.crm_orders.length, 1)
        assert.deepEqual(
          f.tables.crm_order_items.map(({ product_name, quantity, price }) => ({
            product_name,
            quantity,
            price,
          })),
          items.map((item) => ({
            product_name: item.name ?? item.title,
            quantity: item.quantity,
            price: Number(item.price),
          })),
        )
      }
      const before = copy(f.tables)
      f.writes.length = 0
      assert.equal((await f.run(scenarios.at(-1))).body.ok, true)
      assert.deepEqual(f.tables.crm_orders, before.crm_orders)
      assert.deepEqual(f.tables.crm_order_items, before.crm_order_items)
      assert.equal(
        f.orderWrites().filter((write) => write.table !== 'crm_marketplace_order_sync_state')
          .length,
        0,
      )
    })

    test(`${platform} ${mode}: malformed items cause no order writes or financial loss`, async () => {
      const f = harness(platform, targeted)
      const valid = [f.line('A'), f.line('B')]
      assert.equal((await f.run(valid)).body.ok, true)
      f.tables.crm_order_items.forEach((item) =>
        Object.assign(item, {
          cost: 321,
          cost_usd: 7,
          cost_manual: true,
          royalty_manual: true,
          royalty_amount: 15,
        }),
      )
      const saved = copy(f.tables)
      const without = (field) => {
        const item = f.line('B')
        delete item[field]
        return [f.line('A'), item]
      }
      const cases = [
        undefined,
        null,
        {},
        [],
        [null],
        [false],
        [[]],
        without(platform === 'Prom' ? 'name' : 'title'),
        without('quantity'),
        without('price'),
        [f.line('A'), f.line(' ', 2, 100)],
        ...[null, '', 'garbage', '2 units', true, 0, -1].map((quantity) => [
          f.line('A'),
          { ...f.line('B'), quantity },
        ]),
        ...[null, '', 'garbage', '100oops', false, -1].map((price) => [
          f.line('A'),
          { ...f.line('B'), price },
        ]),
      ]
      for (const items of cases) {
        f.writes.length = 0
        const result = await f.run(items)
        assert.equal(result.status, 502, JSON.stringify({ items, result }))
        assert.equal(result.body.ok, false)
        assert.equal(result.body.code, 'INVALID_ORDER_ITEMS')
        assert.equal(f.orderWrites().length, 0)
        assert.deepEqual(f.tables, saved)
      }
      f.writes.length = 0
      const invalidResponse = await f.run(valid, { invalidJson: true })
      assert.equal(invalidResponse.status, 502)
      assert.equal(invalidResponse.body.code, 'INVALID_ORDER_ITEMS')
      assert.equal(f.orderWrites().length, 0)
      assert.deepEqual(f.tables, saved)
    })

    test(`${platform} ${mode}: derived and explicit zero prices`, async () => {
      const f = harness(platform, targeted)
      const item = f.line('A', 2)
      delete item.price
      item[platform === 'Prom' ? 'total_price' : 'subtotal'] = '125,50'
      assert.equal((await f.run([item])).body.ok, true)
      assert.equal(f.tables.crm_order_items[0].price, 62.75)
      item.price = 0
      assert.equal((await f.run([item])).body.ok, true)
      assert.equal(f.tables.crm_order_items[0].price, 0)
    })
  }

  test(`${platform}: non-finite numbers are rejected before JSON encoding`, () => {
    const f = harness(platform, true)
    assert.equal(f.validator(f.order([f.line(' A ')]), platform)[0].title, ' A ')
    for (const value of [NaN, Infinity, -Infinity, 'Infinity', 'NaN', '1e309']) {
      for (const field of ['quantity', 'price'])
        assert.throws(() => f.validator(f.order([{ ...f.line('A'), [field]: value }]), platform))
    }
  })

  test(`${platform}: missing list envelope is an error`, async () => {
    const f = harness(platform, false)
    const result = await f.run([], { malformedList: true })
    assert.equal(result.status, 502)
    assert.equal(f.orderWrites().length, 0)
  })
}

test('Epicentr scheduled: missing detail items never fall back to valid list items', async () => {
  const f = harness('Epicentr', false)
  const valid = [f.line('A'), f.line('B')]
  await f.run(valid)
  const before = copy(f.tables)
  f.writes.length = 0
  const result = await f.run([f.line('C')], { detail: f.order(undefined) })
  assert.equal(result.status, 502)
  assert.equal(f.orderWrites().length, 0)
  assert.deepEqual(f.tables, before)
})

test('Epicentr scheduled: earlier safe writes survive a later invalid order', async () => {
  const f = harness('Epicentr', false)
  const first = f.order([f.line('A')])
  const second = { ...f.order(undefined), id: '43' }
  const result = await f.run(undefined, {
    orders: [first, second],
    details: { 42: first, 43: second },
  })
  assert.equal(result.status, 502)
  assert.equal(result.body.externalId, '43')
  assert.equal(f.tables.crm_orders.length, 1)
  assert.equal(f.tables.crm_orders[0].external_id, '42')
  assert.equal(f.tables.crm_order_items[0].product_name, 'A')
  assert.equal(f.tables.crm_marketplace_order_sync_state.length, 1)
  assert.equal(f.tables.crm_marketplace_order_sync_state[0].external_id, '42')
})

test('Epicentr scheduled: cached malformed list still requires valid detail composition', async () => {
  const f = harness('Epicentr', false)
  const list = [f.order(undefined)]
  assert.equal((await f.run([f.line('A')], { orders: list })).body.ok, true)
  const before = copy(f.tables)
  f.writes.length = 0
  const result = await f.run(undefined, { orders: list })
  assert.equal(result.status, 502)
  assert.equal(result.body.code, 'INVALID_ORDER_ITEMS')
  assert.equal(f.orderWrites().length, 0)
  assert.deepEqual(f.tables, before)
})
