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
    :class="[
      'inline-block w-auto object-contain align-[-0.14em]',
      props.platform === 'Эпицентр' ? 'h-[2em] max-w-36' : 'h-[1.65em] max-w-32',
    ]"
  />
  <span v-else>{{ props.platform }}</span>
</template>
