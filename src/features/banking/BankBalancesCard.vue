<script setup lang="ts">
import type { BankName, BankState } from './types'

defineProps<{ caches: BankState; totalBalance: number | null }>()

const banks = ['monobank', 'novapay'] as const

function bankLabel(bank: BankName) {
  return bank === 'monobank' ? 'Monobank' : 'NovaPay'
}

function formatMoney(value: number) {
  return `${new Intl.NumberFormat('uk-UA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)} ₴`
}

function updatedAt(value: string | null) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return '—'
  return new Intl.DateTimeFormat('uk-UA', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Kyiv',
  }).format(new Date(value))
}
</script>

<template>
  <div class="mt-3 flex flex-wrap gap-3 sm:-mt-[42px] sm:ml-44">
    <section
      v-for="bank in banks"
      :key="bank"
      class="min-w-[210px] rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm"
    >
      <div class="flex items-start justify-between gap-5">
        <div>
          <p class="font-semibold text-slate-900">{{ bankLabel(bank) }}</p>
          <p class="mt-0.5 text-xs text-slate-500">{{ updatedAt(caches[bank].updatedAt) }}</p>
        </div>
        <p class="whitespace-nowrap font-semibold tabular-nums text-slate-950">
          {{ caches[bank].balance === null ? '—' : formatMoney(caches[bank].balance) }}
        </p>
      </div>
      <RouterLink
        class="mt-3 inline-flex rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800"
        :to="`/banking/${bank}`"
      >
        Выписка
      </RouterLink>
    </section>
  </div>
</template>
