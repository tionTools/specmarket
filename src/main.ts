import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './global.css'

import App from './App.vue'
import router from './router'

const staleChunkReloadKey = 'specmarket:stale-chunk-reload'

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  if (sessionStorage.getItem(staleChunkReloadKey) === '1') return
  sessionStorage.setItem(staleChunkReloadKey, '1')
  window.location.reload()
})

void router.isReady().then(() => sessionStorage.removeItem(staleChunkReloadKey))

const app = createApp(App)

app.use(createPinia())
app.use(router)

app.mount('#app')
