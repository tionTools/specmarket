import { readableStatus } from './normalize.ts'

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

Deno.test('Nova refusal wording with отримання is a return in progress', () => {
  const result = readableStatus('Відмова від отримання', '102')
  assert(result.normalizedStatus === 'returning', 'refusal was classified as cancellation')
  assert(result.status === 'Возвращается отправителю', 'refusal got the wrong display status')
  assert(result.final === false, 'return in progress must not be final')
})

Deno.test('Nova refusal wording with одержання remains a return in progress', () => {
  const result = readableStatus('Відмова від одержання', '102')
  assert(result.normalizedStatus === 'returning', 'legacy refusal wording regressed')
})

Deno.test('ordinary cancellation remains cancelled', () => {
  const result = readableStatus('Скасовано', '102')
  assert(result.normalizedStatus === 'cancelled', 'ordinary cancellation became a return')
  assert(result.final === true, 'ordinary cancellation must stay final')
})


Deno.test('carrier Видалено status is a deleted TTN, not an order cancellation', () => {
  const result = readableStatus('Видалено')
  assert(result.normalizedStatus === 'deleted', 'deleted TTN was not classified separately')
  assert(result.status === 'Видалено', 'carrier status text must be preserved')
  assert(result.final === true, 'deleted TTN must stop carrier polling')
})

Deno.test('carrier Удалено status is also a deleted TTN', () => {
  const result = readableStatus('Удалено')
  assert(result.normalizedStatus === 'deleted', 'Russian deleted TTN wording was not recognized')
})
