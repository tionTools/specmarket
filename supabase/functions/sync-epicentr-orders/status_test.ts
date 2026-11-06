import { epicentrStatusName } from './status.ts'

Deno.test('Epicentr delivered means ready for pickup, while finished remains final', () => {
  if (epicentrStatusName('delivered') !== 'Готово до видачі') throw new Error('delivered was marked completed')
  if (epicentrStatusName('finished') !== 'Завершено') throw new Error('finished must remain final')
  if (epicentrStatusName('unknown_code') !== undefined) throw new Error('unknown code must retain the caller fallback')
})
