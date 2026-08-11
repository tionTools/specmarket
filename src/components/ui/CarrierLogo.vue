<script setup lang="ts">
const props = defineProps<{ kind: string }>()

const logoSources: Record<string, string> = {
  nova: '/carrier-logos/nova-poshta.jpg',
  ukr: '/carrier-logos/ukrposhta.png',
  rozetka: '/carrier-logos/rozetka-delivery.png',
  meest: '/carrier-logos/meest.png',
  'meest-pachtmate': '/carrier-logos/meest-pachtmate.png',
  'meest-epicentr-cvz': '/carrier-logos/meest-epicentr-cvz.png',
}

const logoNames: Record<string, string> = {
  nova: 'Новая почта',
  ukr: 'Укрпочта',
  rozetka: 'Rozetka Delivery',
  meest: 'Meest',
  'meest-pachtmate': 'Meest-поштомат',
  'meest-epicentr-cvz': 'Центр выдачи Meest-Эпицентр',
}
</script>

<template>
  <img
    :src="logoSources[props.kind]"
    :alt="logoNames[props.kind]"
    :class="[
      'shrink-0 object-contain',
      ['meest', 'meest-pachtmate'].includes(props.kind) ? 'h-5 max-w-14' : 'size-5',
    ]"
  />
</template>
