<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ArrowLeft, RefreshCw } from '@lucide/vue'
import { useRoute, useRouter } from 'vue-router'

import type { BankName, BankReceipt, BankSnapshot } from '@/features/banking/types'
import { supabase } from '@/lib/supabase'

type BankFunctionResponse = Partial<BankSnapshot> & {
  ok?: boolean
  message?: string
}

const route = useRoute()
const router = useRouter()
const snapshot = ref<BankSnapshot | null>(null)
const isLoading = ref(true)
const isRefreshing = ref(false)
const error = ref('')

const bank = computed<BankName | null>(() => {
  const value = Array.isArray(route.params.bank) ? route.params.bank[0] : route.params.bank
  return value === 'monobank' || value === 'novapay' ? value : null
})

const bankLabel = computed(() => (bank.value === 'novapay' ? 'NovaPay' : 'Monobank'))
const functionName = computed(() => (bank.value === 'novapay' ? 'novapay-data' : 'monobank-data'))

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const result = Number(value)
  return Number.isFinite(result) ? result : null
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function normalizeReceipt(value: unknown): BankReceipt | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const amount = numberOrNull(row.amount)
  if (amount === null) return null
  return {
    id: stringValue(row.id),
    date: stringValue(row.date),
    description: stringValue(row.description),
    amount,
    balance: numberOrNull(row.balance),
    comment: stringValue(row.comment),
  }
}

function normalizeSnapshot(data: BankFunctionResponse): BankSnapshot {
  const receipts = Array.isArray(data.receipts)
    ? data.receipts.flatMap((item) => {
        const receipt = normalizeReceipt(item)
        return receipt ? [receipt] : []
      })
    : []
  const period = data.period && typeof data.period === 'object' ? data.period : {}
  const periodRecord = period as Record<string, unknown>

  return {
    bank: bank.value ?? 'monobank',
    balance: numberOrNull(data.balance),
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null,
    receipts,
    period: {
      from: typeof periodRecord.from === 'string' ? periodRecord.from : null,
      to: typeof periodRecord.to === 'string' ? periodRecord.to : null,
    },
  }
}

function money(value: number | null) {
  if (value === null) return '—'
  return `${new Intl.NumberFormat('uk-UA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)} ₴`
}

function dateTime(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return new Intl.DateTimeFormat('uk-UA', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'Europe/Kyiv',
  }).format(date)
}

function periodDate(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return new Intl.DateTimeFormat('uk-UA', {
    dateStyle: 'short',
    timeZone: 'Europe/Kyiv',
  }).format(date)
}

const periodLabel = computed(() => {
  const from = periodDate(snapshot.value?.period.from ?? null)
  const to = periodDate(snapshot.value?.period.to ?? null)
  return from && to ? `${from} — ${to}` : 'Последние 7 дней'
})

async function load(refresh: boolean) {
  if (!supabase || !bank.value) return
  if (refresh) isRefreshing.value = true
  else isLoading.value = true
  error.value = ''

  try {
    const { data, error: invokeError } = await supabase.functions.invoke<BankFunctionResponse>(
      functionName.value,
      { body: { refresh } },
    )
    if (invokeError) throw invokeError
    if (!data || data.ok === false) throw new Error(data?.message || 'Не удалось получить выписку.')
    snapshot.value = normalizeSnapshot(data)
  } catch (loadError) {
    error.value = loadError instanceof Error ? loadError.message : 'Не удалось получить выписку.'
  } finally {
    isLoading.value = false
    isRefreshing.value = false
  }
}

async function initialize() {
  if (!supabase || !bank.value) {
    await router.replace('/')
    return
  }
  const { data } = await supabase.auth.getSession()
  const session = data.session
  if (!session || session.user.email?.toLowerCase() === 'guest@gmail.com') {
    await router.replace('/')
    return
  }
  await load(false)
}

onMounted(initialize)
</script>

<template>
  <main class="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8">
    <div class="mx-auto max-w-7xl">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <button
          class="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-emerald-300 hover:text-emerald-800"
          type="button"
          @click="router.push('/')"
        >
          <ArrowLeft class="size-4" aria-hidden="true" />
          Назад
        </button>
        <button
          class="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
          type="button"
          :disabled="isLoading || isRefreshing"
          @click="load(true)"
        >
          <RefreshCw :class="['size-4', { 'animate-spin': isRefreshing }]" aria-hidden="true" />
          {{ isRefreshing ? 'Обновляю…' : 'Обновить' }}
        </button>
      </div>

      <section class="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div class="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p class="text-xs font-bold tracking-[0.18em] text-emerald-700">БАНКОВСКИЙ СЧЁТ</p>
            <h1 class="mt-1 text-2xl font-bold text-slate-950">{{ bankLabel }}</h1>
            <p class="mt-2 text-sm text-slate-500">Обновлено: {{ dateTime(snapshot?.updatedAt ?? null) }}</p>
          </div>
          <div class="text-right">
            <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Остаток</p>
            <p class="mt-1 text-2xl font-bold tabular-nums text-slate-950">
              {{ money(snapshot?.balance ?? null) }}
            </p>
          </div>
        </div>
      </section>

      <p
        v-if="error"
        class="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
      >
        {{ error }}
      </p>

      <section class="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div class="flex flex-wrap items-end justify-between gap-2 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 class="text-lg font-bold text-slate-950">Выписка за 7 дней</h2>
            <p class="mt-0.5 text-xs text-slate-500">{{ periodLabel }}</p>
          </div>
          <p class="text-xs text-slate-500">Только входящие поступления</p>
        </div>

        <div v-if="isLoading" class="px-5 py-8 text-sm text-slate-500">Загрузка…</div>
        <div
          v-else-if="!snapshot?.receipts.length"
          class="px-5 py-8 text-sm text-slate-500"
        >
          За этот период поступлений нет.
        </div>
        <div v-else class="overflow-x-auto">
          <table class="w-full min-w-[900px] border-collapse text-sm">
            <thead class="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th class="px-4 py-3">Дата</th>
                <th class="px-4 py-3">Описание</th>
                <th class="px-4 py-3 text-right">Сумма</th>
                <th class="px-4 py-3 text-right">Баланс</th>
                <th class="px-4 py-3">Комментарий</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              <tr v-for="(receipt, index) in snapshot.receipts" :key="receipt.id || `${receipt.date}-${index}`">
                <td class="whitespace-nowrap px-4 py-3 text-slate-600">{{ receipt.date || '—' }}</td>
                <td class="max-w-[280px] px-4 py-3 text-slate-800">{{ receipt.description || '—' }}</td>
                <td class="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-emerald-700">
                  {{ money(receipt.amount) }}
                </td>
                <td class="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-700">
                  {{ money(receipt.balance) }}
                </td>
                <td class="min-w-[320px] px-4 py-3 text-slate-600">{{ receipt.comment || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </main>
</template>
