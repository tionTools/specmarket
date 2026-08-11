<script setup lang="ts">
const props = defineProps<{ kind: string }>()

const logoSources: Record<string, string> = {
  nova: '/carrier-logos/nova-poshta.jpg',
  ukr: '/carrier-logos/ukrposhta.png',
  rozetka: '/carrier-logos/rozetka-delivery.png',
  meest: '/carrier-logos/meest-pachtmate.png',
}

const logoNames: Record<string, string> = {
  nova: 'Новая почта',
  ukr: 'Укрпочта',
  rozetka: 'Rozetka Delivery',
  meest: 'Meest',
}
</script>

<template>
  <img
    :src="logoSources[props.kind]"
    :alt="logoNames[props.kind]"
    :class="['shrink-0 object-contain', props.kind === 'meest' ? 'h-5 max-w-14' : 'size-5']"
  />
</template>
