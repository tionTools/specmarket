<script setup lang="ts">
import { onMounted, onScopeDispose } from 'vue'
import { applyAppearance, appearanceStorageKey, parseAppearance } from '../lib/appearance'
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
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
function currentAppearance() {
  return parseAppearance(window.localStorage.getItem(appearanceStorageKey))
}
function handleSystemTheme() {
  if (currentAppearance() === 'system') applyAppearance('system')
}
applyAppearance(currentAppearance())
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
      <span
        >v{{ buildVersion }}<span v-if="buildTime"> · {{ buildTime }}</span></span
      >
    </footer>
  </div>
</template>
