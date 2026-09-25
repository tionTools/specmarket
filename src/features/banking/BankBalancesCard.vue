<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useNow } from '@vueuse/core'
import type { RealtimeChannel } from '@supabase/supabase-js'

import { currencyRateForDate, localDateKey, type CurrencyRateRow } from '@/features/prices/currencyRates'
import { supabase } from '@/lib/supabase'
import { consumeBankingReturn } from './navigation'
import { hasNovaPaySyncIssue, type NovaPayJournalRow } from './novapayJournal'
import type { BankName, BankState } from './types'

const props = defineProps<{ caches: BankState; totalBalance: number | null }>()

const banks = ['monobank', 'novapay'] as const
const supplierDebt = ref<number | null>(null)
const journal = ref<NovaPayJournalRow[]>([])
const journalUnavailable = ref(false)
const now = useNow({ interval: 60_000 })
let journalChannel: RealtimeChannel | undefined

const syncIssue = computed(() =>
  hasNovaPaySyncIssue(journal.value, props.caches.novapay.updatedAt, now.value),
)

async function loadNovaPayJournal() {
  if (!supabase) return
  const { data, error } = await supabase
    .from('crm_novapay_sync_log')
    .select('id,started_at,finished_at,source,status,stage,code,reason,request_ref')
    .order('started_at', { ascending: false })
    .limit(100)
  journalUnavailable.value = Boolean(error)
  if (!error) journal.value = (data ?? []) as NovaPayJournalRow[]
}

const completeBankTotal = computed(() => {
  const values = banks.map((bank) => props.caches[bank].balance)
  if (values.some((value) => value === null)) return null
  return (values as number[]).reduce((total, value) => total + value, 0)
})

const profitAfterSupplierDebt = computed(() => {
  if (completeBankTotal.value === null || supplierDebt.value === null) return null
  return completeBankTotal.value - supplierDebt.value
})

function bankLabel(bank: BankName) {
  return bank === 'monobank' ? 'Monobank' : 'NovaPay'
}

function formatMoney(value: number) {
  return `${new Intl.NumberFormat('uk-UA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)} ₴`
}

function signedMoney(value: number) {
  return `${value > 0 ? '+' : ''}${formatMoney(value)}`
}

function updatedAt(value: string | null) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return '—'
  return new Intl.DateTimeFormat('uk-UA', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Kyiv',
  }).format(new Date(value))
}

async function loadSupplierDebt() {
  if (!supabase) return

  const [ratesResult, reconciliationsResult, totalsResult] = await Promise.all([
    supabase
      .from('crm_currency_rates')
      .select('effective_from, rate')
      .eq('currency', 'USD')
      .order('effective_from', { ascending: false }),
    supabase
      .from('crm_reconciliations')
      .select(
        'kind,created_at,crm_balance_usd_after_adjustment,crm_balance_uah_after_adjustment,cost_snapshot_usd,cost_snapshot_uah',
      )
      .order('created_at', { ascending: false }),
    supabase.rpc('get_crm_current_cost_totals'),
  ])

  if (ratesResult.error || reconciliationsResult.error || totalsResult.error) {
    console.error(
      'Не удалось рассчитать текущий долг поставщику:',
      ratesResult.error ?? reconciliationsResult.error ?? totalsResult.error,
    )
    return
  }

  const reconciliations = reconciliationsResult.data ?? []
  const checkpoint =
    reconciliations.find((item) => item.kind === 'reconciliation') ??
    reconciliations.find((item) => item.kind === 'initial')
  if (!checkpoint) return

  const currencyRates: CurrencyRateRow[] = (ratesResult.data ?? []).map((row) => ({
    effective_from: String(row.effective_from),
    rate: Number(row.rate),
  }))
  const usdRate = currencyRateForDate(currencyRates, localDateKey(), 0)
  if (usdRate <= 0) return

  const { data: payments, error: paymentsError } = await supabase
    .from('crm_supplier_payments')
    .select('created_at,debt_usd,debt_uah')
    .gt('created_at', checkpoint.created_at)
  if (paymentsError) {
    console.error('Не удалось загрузить платежи поставщику:', paymentsError)
    return
  }

  const paidDebt = (payments ?? []).reduce(
    (total, payment) => ({
      usd: total.usd + Number(payment.debt_usd),
      uah: total.uah + Number(payment.debt_uah),
    }),
    { usd: 0, uah: 0 },
  )
  const currentCosts = (totalsResult.data ?? {}) as { usd?: number; uah?: number }
  const debtUsd =
    Number(checkpoint.crm_balance_usd_after_adjustment) +
    (Number(currentCosts.usd ?? 0) - Number(checkpoint.cost_snapshot_usd)) -
    paidDebt.usd
  const debtUah =
    Number(checkpoint.crm_balance_uah_after_adjustment) +
    (Number(currentCosts.uah ?? 0) - Number(checkpoint.cost_snapshot_uah)) -
    paidDebt.uah

  supplierDebt.value = debtUsd * usdRate + debtUah
}

defineExpose({ refreshDebt: loadSupplierDebt })

function scrollToBankingBlock() {
  if (!consumeBankingReturn()) return
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      document.getElementById('banking')?.scrollIntoView({ behavior: 'auto', block: 'center' })
    })
  })
}

function clearLegacyBankingHash() {
  if (window.location.hash !== '#banking') return
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${window.location.search}`,
  )
}

onMounted(() => {
  clearLegacyBankingHash()
  scrollToBankingBlock()
  void loadSupplierDebt()
  void loadNovaPayJournal()
  if (supabase) {
    journalChannel = supabase
      .channel('crm:novapay-sync-journal')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'crm_novapay_sync_log' },
        () => void loadNovaPayJournal(),
      )
      .subscribe()
  }
})

onUnmounted(() => {
  if (supabase && journalChannel) void supabase.removeChannel(journalChannel)
  journalChannel = undefined
})
</script>

<template>
  <div id="banking" class="mt-3 flex flex-wrap items-stretch gap-3 sm:-mt-[42px] sm:ml-44">
    <div
      v-if="syncIssue"
      class="w-full rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800"
      role="alert"
    >
      NovaPay не обновляется. Последнее успешное обновление: {{ updatedAt(caches.novapay.updatedAt) }}.
      <RouterLink class="underline" to="/banking/novapay">Открыть журнал</RouterLink>
    </div>
    <p v-if="journalUnavailable" class="w-full rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="alert">
      Не удалось проверить журнал NovaPay. Открой выписку для диагностики.
    </p>
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

    <section class="min-w-[170px] rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
      <p class="font-semibold text-slate-700">Всего</p>
      <p class="mt-2 whitespace-nowrap text-lg font-bold tabular-nums text-slate-950">
        {{ totalBalance === null ? '—' : formatMoney(totalBalance) }}
      </p>
    </section>

    <section class="min-w-[230px] rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
      <div class="flex items-center justify-between gap-4">
        <p class="font-semibold text-slate-700">Долг поставщику</p>
        <p class="whitespace-nowrap font-semibold tabular-nums text-slate-950">
          {{ supplierDebt === null ? '—' : formatMoney(supplierDebt) }}
        </p>
      </div>
      <div class="mt-3 flex items-center justify-between gap-4 border-t border-slate-100 pt-3">
        <p class="font-semibold text-slate-700">Моя прибыль</p>
        <p
          class="whitespace-nowrap text-lg font-bold tabular-nums"
          :class="
            profitAfterSupplierDebt === null
              ? 'text-slate-400'
              : profitAfterSupplierDebt >= 0
                ? 'text-emerald-700'
                : 'text-rose-600'
          "
        >
          {{ profitAfterSupplierDebt === null ? '—' : signedMoney(profitAfterSupplierDebt) }}
        </p>
      </div>
    </section>
  </div>
</template>
