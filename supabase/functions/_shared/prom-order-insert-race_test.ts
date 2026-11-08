import { recoverConcurrentPromInsert } from './prom-order-insert-race.ts'

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

const conflict = {
  code: '23505',
  message: 'duplicate key value violates unique constraint "crm_orders_external_id_unique"',
}

Deno.test('only the crm_orders external_id uniqueness race is recoverable', async () => {
  let lookups = 0
  const lookup = async () => {
    lookups += 1
    return 'winner-id'
  }
  assert(!(await recoverConcurrentPromInsert(null, lookup)), 'Missing error recovered')
  assert(!(await recoverConcurrentPromInsert({ code: '23505', message: 'other_unique_constraint' }, lookup)), 'Other unique error recovered')
  assert(!(await recoverConcurrentPromInsert({ code: '42501', message: conflict.message }, lookup)), 'Other error code recovered')
  assert(lookups === 0, 'Unrelated errors must not read the database')
})

Deno.test('confirmed concurrent creation skips the loser without an upsert', async () => {
  let lookups = 0
  const recovered = await recoverConcurrentPromInsert(conflict, async () => {
    lookups += 1
    return 'already-created-order-id'
  })
  assert(recovered, 'Existing winner must be acknowledged')
  assert(lookups === 1, 'Only one read is necessary')
})

Deno.test('unconfirmed conflict and failed lookup remain errors', async () => {
  assert(!(await recoverConcurrentPromInsert(conflict, async () => null)), 'Missing winner must not be ignored')
  assert(!(await recoverConcurrentPromInsert(conflict, async () => { throw new Error('DB unavailable') })), 'Lookup failure must not be ignored')
})
