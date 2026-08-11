<script setup lang="ts">
const props = defineProps<{ platform: string }>()

const logoSources: Record<string, string> = {
  Пром: '/platform-logos/prom.png',
  Каста: '/platform-logos/kasta.png',
  Эпицентр: '/platform-logos/epicentr.png',
}
</script>

<template>
  <img
    v-if="logoSources[props.platform]"
    :src="logoSources[props.platform]"
    :alt="props.platform"
    class="inline-block h-[1.65em] w-auto max-w-32 object-contain align-[-0.14em]"
  />
  <span v-else>{{ props.platform }}</span>
</template>
