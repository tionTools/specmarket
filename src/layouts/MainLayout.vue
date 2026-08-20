<script setup lang="ts">
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
</script>

<template>
  <div class="min-h-screen flex flex-col bg-white">
    <main class="flex flex-col flex-1">
      <RouterView />
    </main>
    <footer class="px-4 pb-2 text-right text-[10px] text-slate-400" aria-label="Версія CRM">
      v{{ buildVersion }}<span v-if="buildTime"> · {{ buildTime }}</span>
    </footer>
  </div>
</template>
