import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './global.css'
import { applyAppearance, appearanceStorageKey, parseAppearance } from './lib/appearance'

import App from './App.vue'
import router from './router'

const staleChunkReloadKey = 'specmarket:stale-chunk-reload'
const pendingRouteKey = 'specmarket:pending-route'
applyAppearance(parseAppearance(window.localStorage.getItem(appearanceStorageKey)))

router.beforeEach((to) => {
  const isRecoveringFromStaleChunk =
    sessionStorage.getItem(staleChunkReloadKey) === '1' &&
    Boolean(sessionStorage.getItem(pendingRouteKey))
  if (!isRecoveringFromStaleChunk) sessionStorage.setItem(pendingRouteKey, to.fullPath)
})

router.afterEach((to, _from, failure) => {
  if (!failure && sessionStorage.getItem(pendingRouteKey) === to.fullPath) {
    sessionStorage.removeItem(pendingRouteKey)
  }
})

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  if (sessionStorage.getItem(staleChunkReloadKey) === '1') return
  sessionStorage.setItem(staleChunkReloadKey, '1')
  window.location.reload()
})

void router.isReady().then(async () => {
  const pendingRoute = sessionStorage.getItem(pendingRouteKey)
  if (
    sessionStorage.getItem(staleChunkReloadKey) === '1' &&
    pendingRoute &&
    pendingRoute !== router.currentRoute.value.fullPath
  ) {
    try {
      await router.replace(pendingRoute)
    } catch (error) {
      console.error('Не удалось восстановить страницу после перезагрузки:', error)
    } finally {
      sessionStorage.removeItem(staleChunkReloadKey)
    }
    return
  }
  sessionStorage.removeItem(staleChunkReloadKey)
})

const app = createApp(App)

app.use(createPinia())
app.use(router)

app.mount('#app')
