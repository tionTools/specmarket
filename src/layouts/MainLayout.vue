<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref, watch } from 'vue'
import {
  applyAppearance,
  appearanceStorageKey,
  parseAppearance,
  type Appearance,
} from '../lib/appearance'
const rawBuildTime = import.meta.env.VITE_BUILD_TIME?.trim()
const buildDate = rawBuildTime ? new Date(rawBuildTime) : null
const buildTime =
  buildDate && Number.isFinite(buildDate.getTime())
    ? new Intl.DateTimeFormat('uk-UA', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'Europe/Kyiv',
      }).format(buildDate)
    : ''
const buildVersion = import.meta.env.VITE_BUILD_SHA?.trim().slice(0, 7) || 'local'
const appearance = ref<Appearance>(
  parseAppearance(window.localStorage.getItem(appearanceStorageKey)),
)
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
const appearanceLabel = computed(
  () => ({ system: 'Системная', light: 'Светлая', dark: 'Тёмная' })[appearance.value],
)
function handleAppearance(event: Event) {
  appearance.value = (event.target as HTMLSelectElement).value as Appearance
}
function handleSystemTheme() {
  if (appearance.value === 'system') applyAppearance(appearance.value)
}
watch(
  appearance,
  (value) => {
    window.localStorage.setItem(appearanceStorageKey, value)
    applyAppearance(value)
  },
  { immediate: true },
)
onMounted(() => systemTheme.addEventListener('change', handleSystemTheme))
onScopeDispose(() => systemTheme.removeEventListener('change', handleSystemTheme))
</script>

<template>
  <div class="min-h-screen flex flex-col bg-[var(--surface)] text-[var(--text)]">
    <main class="flex flex-col flex-1">
      <RouterView />
    </main>
    <footer
      class="flex items-center justify-end gap-2 px-4 pb-2 text-right text-[10px] text-[var(--muted)]"
      aria-label="Версія CRM"
    >
      <label
        >Оформление
        <select
          class="rounded border border-[var(--border)] bg-[var(--surface)] p-1 text-[var(--text)]"
          :value="appearance"
          :aria-label="`Оформление: ${appearanceLabel}`"
          @change="handleAppearance"
        >
          <option value="system">Системная</option>
          <option value="light">Светлая</option>
          <option value="dark">Тёмная</option>
        </select></label
      >
      <span
        >v{{ buildVersion }}<span v-if="buildTime"> · {{ buildTime }}</span></span
      >
    </footer>
  </div>
</template>
