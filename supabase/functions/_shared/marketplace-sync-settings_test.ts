import { marketplacePausedResponse, marketplaceSettingsUnavailableResponse } from './marketplace-sync-settings.ts'

function assert(value: unknown): asserts value {
  if (!value) throw new Error('Assertion failed')
}

Deno.test('marketplace pause has explicit scheduled skip and manual rejection', async () => {
  const scheduled = marketplacePausedResponse('Каста', true, {})
  assert(scheduled.status === 200)
  const scheduledJson = await scheduled.json()
  assert(scheduledJson.ok === true && scheduledJson.skipped === 'paused')
  const manual = marketplacePausedResponse('Каста', false, {})
  assert(manual.status === 409)
  const manualJson = await manual.json()
  assert(manualJson.code === 'MARKETPLACE_PAUSED')
  const unavailable = marketplaceSettingsUnavailableResponse({})
  assert(unavailable.status === 503)
})
