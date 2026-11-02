import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const source = readFileSync(new URL('../../pages/HomeView.vue', import.meta.url), 'utf8')
const mounted = source.slice(
  source.indexOf('onMounted(async () => {'),
  source.indexOf('\nonScopeDispose('),
)

test('return opens and scrolls after route cleanup, before slow banking requests', async () => {
  for (const id of ['58676980', 306]) {
    const events = []
    const expandedOrderId = { value: null }
    const route = { query: { returnOrder: String(id), returnSearch: 'boots' } }
    let finishBanking
    const banking = new Promise((resolve) => {
      finishBanking = resolve
    })
    let mountedPromise
    runInNewContext(mounted, {
      onMounted: (callback) => {
        mountedPromise = callback()
      },
      watch() {},
      documentVisibility: {},
      handleOrdersVisibilityChange() {},
      isOnline: {},
      handleBrowserOnline() {},
      dismissNewOrderToastsOnPointerDown() {},
      loadRemoteOrders: async () => {},
      initializeLabelReminders() {},
      labelReminderInterval: null,
      checkLabelReminderThresholds() {},
      startAutomaticOrdersRefresh() {},
      window: { setInterval() {}, sessionStorage: { getItem: () => null } },
      document: {
        addEventListener() {},
        getElementById: () => ({ scrollIntoView: () => events.push('scroll') }),
      },
      bankingMonitor: {
        start: () => {
          events.push('bank')
          return banking
        },
      },
      route,
      manualOrderPriceDraftStorageKey: 'draft',
      restoreManualOrderDraftFromPriceSelection: () => false,
      restoreRegistryDraftNavigation() {},
      searchQuery: { value: '' },
      orderDialog: { value: null },
      orders: { value: [{ id }] },
      expandedOrderId,
      nextTick: async () => {},
      router: {
        replace: async () => {
          events.push('route')
          route.query = {}
        },
      },
    })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(expandedOrderId.value, id)
    assert.deepEqual(events, ['route', 'scroll', 'bank'])
    finishBanking()
    await mountedPromise
  }
})
