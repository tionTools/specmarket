import { acceptPromOrders, canAcceptPromOrder, classifyPromOrderStatus, normalizePromExternalIds, promConfirmedAcceptance, type AcceptanceOrder, type AcceptancePorts } from './prom-order-action.ts'

function assert(value: unknown, message = 'Assertion failed'): asserts value {
  if (!value) throw new Error(message)
}

Deno.test('Prom IDs: normalization, deduplication, blanks and trust boundary', () => {
  assert(JSON.stringify(normalizePromExternalIds([' prom:1 ', '2', 2, 'PROM: 3', '', '   '])) === '["1","2","3"]')
  assert(normalizePromExternalIds([]).length === 0)
  for (const invalid of [null, {}, '1', [null], [{}], [true], ['abc'], ['1e3'], ['-1'], ['0'], ['9007199254740993'], Array.from({ length: 101 }, (_, i) => String(i + 1))]) {
    let rejected = false
    try { normalizePromExternalIds(invalid) } catch { rejected = true }
    assert(rejected, 'Invalid IDs accepted: ' + JSON.stringify(invalid))
  }
})

Deno.test('Prom eligibility rejects final, unknown and misleading accepted spellings', () => {
  for (const status of ['Новий', 'Новый', 'new', 'pending', ' PENDING ']) {
    assert(classifyPromOrderStatus(status) === 'new')
    assert(canAcceptPromOrder('Пром', status))
    for (const platform of ['Каста', 'Kasta', 'Эпицентр', 'Epicentr']) assert(!canAcceptPromOrder(platform, status))
  }
  for (const status of ['Принято', 'received', 'accepted']) assert(classifyPromOrderStatus(status) === 'alreadyAccepted')
  for (const status of ['canceled', 'cancelled', 'скасовано', 'return', 'returned', 'повернено', 'возврат', 'completed', 'delivered', 'виконано', 'not accepted', 'Принято перевозчиком', '']) {
    assert(classifyPromOrderStatus(status) === 'forbidden', status)
    assert(!canAcceptPromOrder('Пром', status), status)
  }
})

function fixture(statuses: string[], apiOk = true, saveOk = true) {
  const rows: AcceptanceOrder[] = statuses.map((status, i) => ({ id: 'uuid-' + (i + 1), external_id: 'prom:' + (i + 1), status, updated_at: '2026-09-06T12:00:00Z' }))
  const calls: string[] = []
  const ports: AcceptancePorts = {
    load: async (ids) => { assert(ids.every((id) => id.startsWith('prom:'))); return rows },
    setReceived: async (ids) => { calls.push('api:' + ids.join(',')); return apiOk },
    save: async (row) => { calls.push('save:' + row.id); assert(row.updated_at.length > 0); return saveOk },
  }
  return { ports, calls }
}

Deno.test('HTTP success alone or partial processed_ids does not confirm acceptance', () => {
  assert(promConfirmedAcceptance({ processed_ids: [1, 2], warning_message: null }, [1, 2]))
  for (const result of [null, {}, { success: true }, { processed_ids: [1] }, { processed_ids: [] }, { processed_ids: ['1', '2'] }]) {
    assert(!promConfirmedAcceptance(result, [1, 2]))
  }
})

Deno.test('new orders call Prom before persisting; accepted orders are idempotent', async () => {
  const { ports, calls } = fixture(['Новий', 'Принято'])
  const result = await acceptPromOrders(['1', '2'], ports)
  assert(result.status === 200 && result.body.accepted === 1)
  assert(JSON.stringify(calls) === '["api:1","save:uuid-1"]')
  const accepted = fixture(['received'])
  assert((await acceptPromOrders(['1'], accepted.ports)).body.accepted === 0)
  assert(accepted.calls.length === 0)
})

Deno.test('any missing or forbidden order rejects the entire action without writes', async () => {
  for (const states of [['Новий', 'cancelled'], ['delivered'], []]) {
    const f = fixture(states)
    assert((await acceptPromOrders(['1', '2'], f.ports)).status === 409)
    assert(f.calls.length === 0)
  }
})

Deno.test('Prom failure never changes CRM; concurrent CRM changes are conflicts', async () => {
  const rejected = fixture(['new'], false)
  assert((await acceptPromOrders(['1'], rejected.ports)).status === 502)
  assert(JSON.stringify(rejected.calls) === '["api:1"]')
  const conflict = fixture(['new'], true, false)
  const result = await acceptPromOrders(['1'], conflict.ports)
  assert(result.status === 409 && !result.body.ok)
  assert(result.body.changedOrderIds.length === 0)
})
