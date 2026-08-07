<script setup lang="ts">
const someKey = import.meta.env.VITE_SOME_KEY
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-white">
    <div class="text-center">
      <h1 class="text-5xl font-light tracking-widest text-gray-900 uppercase">
        {{ someKey }}
      </h1>
      <p class="mt-4 text-gray-600 tracking-wide">Something new is on its way.</p>
    </div>
  </div>
</template>
