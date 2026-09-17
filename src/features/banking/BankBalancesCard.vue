<script setup lang="ts">
import type { BankState } from './types'

defineProps<{ caches: BankState; totalBalance: number | null }>()

const banks = ['monobank', 'novapay'] as const

function formatMoney(value: number) {
  return `${new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} ₴`
}

function updatedAt(value: string | null) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return '—'
  return new Intl.DateTimeFormat('uk-UA', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Kyiv' }).format(new Date(value))
}
</script>

<template>
  <section class="mt-3 max-w-sm rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
    <p class="font-semibold text-slate-900">Остатки на счетах</p>
    <div v-for="bank in banks" :key="bank" class="mt-3 flex items-start justify-between gap-4">
      <div>
        <p class="font-medium text-slate-700">{{ bank === 'monobank' ? 'Monobank' : 'NovaPay' }}</p>
        <p class="text-xs text-slate-500">{{ updatedAt(caches[bank].updatedAt) }}</p>
      </div>
      <p class="font-semibold text-slate-900">{{ caches[bank].balance === null ? '—' : formatMoney(caches[bank].balance) }}</p>
    </div>
    <div class="mt-3 flex justify-between border-t border-slate-200 pt-3 font-semibold text-slate-950">
      <span>Всего</span><span>{{ totalBalance === null ? '—' : formatMoney(totalBalance) }}</span>
    </div>
  </section>
</template>
