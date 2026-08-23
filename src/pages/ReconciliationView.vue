<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { supabase } from '@/lib/supabase'

type Reconciliation = {
  id: string
  kind: 'initial' | 'reconciliation'
  reconciled_at: string
  usd_rate: number
  accounting_usd: number
  accounting_uah: number
  accounting_total: number
  reserve_uah: number
  crm_balance_usd_before_adjustment: number
  crm_balance_uah_before_adjustment: number
  crm_balance_usd_after_adjustment: number
  crm_balance_uah_after_adjustment: number
  crm_balance_before_adjustment: number
  adjustment_uah: number
  crm_balance_after_adjustment: number
  discrepancy_uah: number
  cost_snapshot_usd: number
  cost_snapshot_uah: number
  created_at: string
}

type SupplierPayment = {
  id: string
  paid_at: string
  amount_uah: number
  supplier_rate: number
  debt_usd: number
  debt_uah: number
  note: string | null
  created_at: string
}

const router = useRouter()
const reconciliations = ref<Reconciliation[]>([])
const payments = ref<SupplierPayment[]>([])
const usdRate = ref(0)
const currentCostUsd = ref(0)
const currentCostUah = ref(0)
const isGuest = ref(false)
const isLoading = ref(true)
const isSaving = ref(false)
const notice = ref('')
const error = ref('')

const initialDate = ref(new Date().toISOString().slice(0, 10))
const initialDebtUsd = ref('')
const initialDebtUah = ref('')
const paymentDate = ref(new Date().toISOString().slice(0, 10))
const paymentTransferredUah = ref('')
const paymentSupplierRate = ref('')
const paymentDebtUsd = ref('')
const paymentDebtUah = ref('')
const paymentNote = ref('')
const accountingUsd = ref('')
const accountingUah = ref('')
const reserveUah = ref('')
const adjustmentUah = ref('')

function parsedNumber(value: string) {
  const normalized = value.trim().replace(',', '.')
  if (!normalized) return null
  const result = Number(normalized)
  return Number.isFinite(result) ? result : null
}

function numberValue(value: string) {
  return parsedNumber(value) ?? 0
}

function committedNumericValue(value: string) {
  const parsed = parsedNumber(value)
  return parsed === null ? value : String(parsed).replace('.', ',')
}

function money(value: number) {
  return new Intl.NumberFormat('uk-UA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function paymentEquivalent(
  payment: Pick<SupplierPayment, 'supplier_rate' | 'debt_usd' | 'debt_uah'>,
) {
  return Number(payment.debt_usd) * Number(payment.supplier_rate) + Number(payment.debt_uah)
}

function reconciliationTotal(item: Reconciliation) {
  return (
    Number(item.crm_balance_usd_after_adjustment) * Number(item.usd_rate) +
    Number(item.crm_balance_uah_after_adjustment)
  )
}

function accountingTotalForHistory(item: Reconciliation) {
  return Number(item.accounting_usd) * Number(item.usd_rate) + Number(item.accounting_uah)
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat('uk-UA', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(value),
  )
}

const initialCheckpoint = computed(
  () => reconciliations.value.find((item) => item.kind === 'initial') ?? null,
)
const latestReconciliation = computed(
  () => reconciliations.value.find((item) => item.kind === 'reconciliation') ?? null,
)
const financialCheckpoint = computed(() => latestReconciliation.value ?? initialCheckpoint.value)
const paidDebt = computed(() => {
  const checkpoint = financialCheckpoint.value
  if (!checkpoint) return { usd: 0, uah: 0 }
  return payments.value
    .filter((payment) => payment.created_at > checkpoint.created_at)
    .reduce(
      (total, payment) => ({
        usd: total.usd + Number(payment.debt_usd),
        uah: total.uah + Number(payment.debt_uah),
      }),
      { usd: 0, uah: 0 },
    )
})
const myDebtUsd = computed(() => {
  const checkpoint = financialCheckpoint.value
  if (!checkpoint) return 0
  return (
    Number(checkpoint.crm_balance_usd_after_adjustment) +
    (currentCostUsd.value - Number(checkpoint.cost_snapshot_usd)) -
    paidDebt.value.usd
  )
})
const myDebtUah = computed(() => {
  const checkpoint = financialCheckpoint.value
  if (!checkpoint) return 0
  return (
    Number(checkpoint.crm_balance_uah_after_adjustment) +
    (currentCostUah.value - Number(checkpoint.cost_snapshot_uah)) -
    paidDebt.value.uah
  )
})
const myNumber = computed(() => myDebtUsd.value * usdRate.value + myDebtUah.value)
const accountingTotal = computed(
  () => numberValue(accountingUsd.value) * usdRate.value + numberValue(accountingUah.value),
)
const accountingForComparison = computed(
  () => accountingTotal.value - numberValue(reserveUah.value),
)
const myNumberAfterAdjustment = computed(() => myNumber.value + numberValue(adjustmentUah.value))
const paymentDraftEquivalent = computed(
  () =>
    numberValue(paymentDebtUsd.value) * numberValue(paymentSupplierRate.value) +
    numberValue(paymentDebtUah.value),
)
const paymentDraftDifference = computed(
  () => numberValue(paymentTransferredUah.value) - paymentDraftEquivalent.value,
)
const hasAccountingInput = computed(() =>
  Boolean(accountingUsd.value.trim() || accountingUah.value.trim()),
)
const discrepancy = computed(() =>
  hasAccountingInput.value ? accountingForComparison.value - myNumberAfterAdjustment.value : null,
)
const history = computed(() => reconciliations.value)

async function load() {
  if (!supabase) {
    error.value = 'Нет настроек Supabase в опубликованной версии сайта.'
    isLoading.value = false
    return
  }
  const { data: session } = await supabase.auth.getSession()
  if (!session.session) {
    await router.replace('/')
    return
  }
  isGuest.value = session.session.user.email?.toLowerCase() === 'guest@gmail.com'
  const [settingsResult, reconciliationsResult, paymentsResult, totalsResult] = await Promise.all([
    supabase.from('crm_settings').select('numeric_value').eq('key', 'usd_rate').maybeSingle(),
    supabase.from('crm_reconciliations').select('*').order('created_at', { ascending: false }),
    supabase.from('crm_supplier_payments').select('*').order('paid_at', { ascending: false }),
    supabase.rpc('get_crm_current_cost_totals'),
  ])
  if (
    settingsResult.error ||
    reconciliationsResult.error ||
    paymentsResult.error ||
    totalsResult.error
  ) {
    error.value = [
      settingsResult.error,
      reconciliationsResult.error,
      paymentsResult.error,
      totalsResult.error,
    ]
      .flatMap((item) => (item ? [item.message] : []))
      .join(' ')
    isLoading.value = false
    return
  }
  usdRate.value = Number(settingsResult.data?.numeric_value ?? 0)
  reconciliations.value = (reconciliationsResult.data ?? []).map((item) => ({
    ...item,
    kind: item.kind as Reconciliation['kind'],
  })) as Reconciliation[]
  payments.value = paymentsResult.data ?? []
  const currentCosts = (totalsResult.data ?? {}) as { usd?: number; uah?: number }
  currentCostUsd.value = Number(currentCosts.usd ?? 0)
  currentCostUah.value = Number(currentCosts.uah ?? 0)
  isLoading.value = false
}

async function saveInitialBalance() {
  if (!supabase || isGuest.value || initialCheckpoint.value) return
  const debtUsd = parsedNumber(initialDebtUsd.value)
  const debtUah = parsedNumber(initialDebtUah.value)
  if (
    !initialDate.value ||
    debtUsd === null ||
    debtUah === null ||
    debtUsd < 0 ||
    debtUah < 0 ||
    usdRate.value <= 0
  ) {
    error.value = 'Укажите дату и начальный долг в USD и гривне.'
    return
  }
  isSaving.value = true
  error.value = ''
  const { error: saveError } = await supabase.from('crm_reconciliations').insert({
    kind: 'initial',
    reconciled_at: new Date(`${initialDate.value}T12:00:00`).toISOString(),
    usd_rate: usdRate.value,
    crm_balance_usd_before_adjustment: debtUsd,
    crm_balance_uah_before_adjustment: debtUah,
    crm_balance_usd_after_adjustment: debtUsd,
    crm_balance_uah_after_adjustment: debtUah,
    crm_balance_before_adjustment: debtUsd * usdRate.value + debtUah,
    crm_balance_after_adjustment: debtUsd * usdRate.value + debtUah,
    cost_snapshot_usd: currentCostUsd.value,
    cost_snapshot_uah: currentCostUah.value,
  })
  isSaving.value = false
  if (saveError) {
    error.value = saveError.message
    return
  }
  notice.value = 'Начальный долг и snapshot себестоимости в двух валютах зафиксированы.'
  await load()
}

async function addPayment() {
  const amount = parsedNumber(paymentTransferredUah.value)
  const supplierRate = parsedNumber(paymentSupplierRate.value)
  const debtUsd = parsedNumber(paymentDebtUsd.value)
  const debtUah = parsedNumber(paymentDebtUah.value)
  if (
    !supabase ||
    isGuest.value ||
    !initialCheckpoint.value ||
    !paymentDate.value ||
    amount === null ||
    supplierRate === null ||
    debtUsd === null ||
    debtUah === null ||
    amount <= 0 ||
    supplierRate <= 0 ||
    debtUsd < 0 ||
    debtUah < 0 ||
    (debtUsd === 0 && debtUah === 0)
  ) {
    error.value = 'Укажите дату, перечисленную сумму, курс поставщика и закрытую часть долга.'
    return
  }
  isSaving.value = true
  error.value = ''
  const { error: saveError } = await supabase.from('crm_supplier_payments').insert({
    paid_at: paymentDate.value,
    amount_uah: amount,
    supplier_rate: supplierRate,
    debt_usd: debtUsd,
    debt_uah: debtUah,
    note: paymentNote.value.trim() || null,
  })
  isSaving.value = false
  if (saveError) {
    error.value = saveError.message
    return
  }
  paymentTransferredUah.value = ''
  paymentSupplierRate.value = ''
  paymentDebtUsd.value = ''
  paymentDebtUah.value = ''
  paymentNote.value = ''
  notice.value = 'Платёж поставщику добавлен. Валютные остатки пересчитаны.'
  await load()
}

async function deletePayment(payment: SupplierPayment) {
  if (
    !supabase ||
    isGuest.value ||
    isSaving.value ||
    !window.confirm(
      `Удалить платёж поставщику от ${payment.paid_at} на ${money(Number(payment.amount_uah))} грн?`,
    )
  )
    return
  isSaving.value = true
  const { error: deleteError } = await supabase
    .from('crm_supplier_payments')
    .delete()
    .eq('id', payment.id)
  isSaving.value = false
  if (deleteError) {
    error.value = deleteError.message
    return
  }
  notice.value = 'Платёж удалён. Валютные остатки пересчитаны.'
  await load()
}

async function deleteLatestReconciliation() {
  const reconciliation = latestReconciliation.value
  if (
    !supabase ||
    isGuest.value ||
    isSaving.value ||
    !reconciliation ||
    !window.confirm('Удалить последнюю сверку и вернуться к предыдущей точке отсчёта?')
  )
    return
  isSaving.value = true
  const { error: deleteError } = await supabase
    .from('crm_reconciliations')
    .delete()
    .eq('id', reconciliation.id)
    .eq('kind', 'reconciliation')
  isSaving.value = false
  if (deleteError) {
    error.value = deleteError.message
    return
  }
  notice.value = 'Последняя сверка удалена. Предыдущая точка снова используется для расчёта.'
  await load()
}

async function saveReconciliation() {
  if (!supabase || isGuest.value || !initialCheckpoint.value) return
  if (!hasAccountingInput.value || discrepancy.value === null) {
    error.value = 'Введите доллары 1С или гривну 1С перед фиксацией сверки.'
    return
  }
  const accountingUsdValue = accountingUsd.value.trim() ? parsedNumber(accountingUsd.value) : 0
  const accountingUahValue = accountingUah.value.trim() ? parsedNumber(accountingUah.value) : 0
  const reserveValue = reserveUah.value.trim() ? parsedNumber(reserveUah.value) : 0
  const adjustmentValue = adjustmentUah.value.trim() ? parsedNumber(adjustmentUah.value) : 0
  if (
    accountingUsdValue === null ||
    accountingUahValue === null ||
    reserveValue === null ||
    adjustmentValue === null ||
    accountingUsdValue < 0 ||
    accountingUahValue < 0 ||
    reserveValue < 0 ||
    usdRate.value <= 0
  ) {
    error.value = 'Проверьте числовые значения и текущий курс CRM.'
    return
  }
  isSaving.value = true
  error.value = ''
  const { error: saveError } = await supabase.from('crm_reconciliations').insert({
    kind: 'reconciliation',
    usd_rate: usdRate.value,
    accounting_usd: accountingUsdValue,
    accounting_uah: accountingUahValue,
    accounting_total: accountingTotal.value,
    reserve_uah: reserveValue,
    crm_balance_before_adjustment: myNumber.value,
    adjustment_uah: adjustmentValue,
    crm_balance_after_adjustment: myNumberAfterAdjustment.value,
    crm_balance_usd_before_adjustment: myDebtUsd.value,
    crm_balance_uah_before_adjustment: myDebtUah.value,
    crm_balance_usd_after_adjustment: myDebtUsd.value,
    crm_balance_uah_after_adjustment: myDebtUah.value + adjustmentValue,
    discrepancy_uah: discrepancy.value,
    cost_snapshot_usd: currentCostUsd.value,
    cost_snapshot_uah: currentCostUah.value,
  })
  isSaving.value = false
  if (saveError) {
    error.value = saveError.message
    return
  }
  accountingUsd.value = ''
  accountingUah.value = ''
  reserveUah.value = ''
  adjustmentUah.value = ''
  notice.value = 'Сверка зафиксирована. Итоговое сальдо стало новой точкой отсчёта.'
  await load()
}

onMounted(load)
</script>

<template>
  <main class="min-h-screen bg-slate-50 p-5 text-slate-900 sm:p-8">
    <div class="mx-auto max-w-6xl">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p class="text-xs font-bold tracking-[0.2em] text-emerald-700">SPECMARKET CRM</p>
          <h1 class="mt-2 text-3xl font-semibold">Сверка расчётов</h1>
        </div>
        <button
          class="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold"
          @click="router.push('/')"
        >
          ← К заказам
        </button>
      </div>

      <p
        v-if="notice"
        class="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
      >
        {{ notice }}
      </p>
      <p
        v-if="error"
        class="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
      >
        {{ error }}
      </p>
      <p v-if="isLoading" class="mt-5 text-sm text-slate-500">Загружаем сверку…</p>

      <template v-else>
        <section
          v-if="!initialCheckpoint"
          class="mt-5 max-w-xl rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm"
        >
          <h2 class="text-lg font-bold text-amber-950">Начальное сальдо</h2>
          <p class="mt-1 text-sm text-amber-900">
            Это разовая точка отсчёта. Себестоимости CRM в USD и гривне сохранятся отдельно.
          </p>
          <div class="mt-4 grid gap-3 sm:grid-cols-2">
            <label class="text-sm font-medium"
              >Дата<input
                v-model="initialDate"
                :disabled="isGuest || isSaving"
                class="mt-1 block w-full rounded-lg border border-amber-200 bg-white px-3 py-2"
                type="date"
            /></label>
            <label class="text-sm font-medium"
              >Долг поставщику, USD<input
                v-model="initialDebtUsd"
                :disabled="isGuest || isSaving"
                class="mt-1 block w-full rounded-lg border border-amber-200 bg-white px-3 py-2"
                inputmode="decimal"
                placeholder="0,00"
                @keydown.enter.prevent="initialDebtUsd = committedNumericValue(initialDebtUsd)"
            /></label>
            <label class="text-sm font-medium"
              >Долг поставщику, грн<input
                v-model="initialDebtUah"
                :disabled="isGuest || isSaving"
                class="mt-1 block w-full rounded-lg border border-amber-200 bg-white px-3 py-2"
                inputmode="decimal"
                placeholder="0,00"
                @keydown.enter.prevent="initialDebtUah = committedNumericValue(initialDebtUah)"
            /></label>
          </div>
          <button
            :disabled="isGuest || isSaving"
            class="mt-4 rounded-xl bg-amber-700 px-4 py-2.5 font-semibold text-white disabled:opacity-50"
            @click="saveInitialBalance"
          >
            {{ isSaving ? 'Сохраняем…' : 'Зафиксировать начальное сальдо' }}
          </button>
        </section>

        <template v-else>
          <section class="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div class="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 class="text-lg font-bold">Текущий долг</h2>
                <p class="mt-1 text-sm text-slate-500">
                  Курс берётся из раздела «Цены». Snapshot себестоимостей ведётся отдельно в USD и
                  гривне.
                </p>
              </div>
              <strong class="rounded-xl bg-emerald-50 px-3 py-2 text-emerald-900"
                >Моя сумма: {{ money(myNumber) }} грн</strong
              >
            </div>
            <div class="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label class="text-sm font-medium text-slate-600"
                >Курс<input
                  :value="money(usdRate)"
                  readonly
                  class="mt-1 block w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 font-semibold text-slate-700"
              /></label>
              <label class="text-sm font-medium text-slate-600"
                >Доллары 1С<input
                  v-model="accountingUsd"
                  :disabled="isGuest"
                  class="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"
                  inputmode="decimal"
                  placeholder="0,00"
                  @keydown.enter.prevent="accountingUsd = committedNumericValue(accountingUsd)"
              /></label>
              <label class="text-sm font-medium text-slate-600"
                >Гривна 1С<input
                  v-model="accountingUah"
                  :disabled="isGuest"
                  class="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"
                  inputmode="decimal"
                  placeholder="0,00"
                  @keydown.enter.prevent="accountingUah = committedNumericValue(accountingUah)"
              /></label>
              <label class="text-sm font-medium text-slate-600"
                >Всего 1С<input
                  :value="hasAccountingInput ? money(accountingTotal) : '—'"
                  readonly
                  class="mt-1 block w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 font-semibold text-slate-700"
              /></label>
              <label class="text-sm font-medium text-slate-600"
                >Бронь<input
                  v-model="reserveUah"
                  :disabled="isGuest"
                  class="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"
                  inputmode="decimal"
                  placeholder="0,00"
                  @keydown.enter.prevent="reserveUah = committedNumericValue(reserveUah)"
              /></label>
              <label class="text-sm font-medium text-slate-600"
                >1С для сверки<input
                  :value="hasAccountingInput ? money(accountingForComparison) : '—'"
                  readonly
                  class="mt-1 block w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 font-semibold text-slate-700"
              /></label>
              <label class="text-sm font-medium text-slate-600"
                >Мои доллары<input
                  :value="money(myDebtUsd)"
                  readonly
                  class="mt-1 block w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 font-semibold text-slate-700"
              /></label>
              <label class="text-sm font-medium text-slate-600"
                >Моя гривна<input
                  :value="money(myDebtUah)"
                  readonly
                  class="mt-1 block w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 font-semibold text-slate-700"
              /></label>
              <label class="text-sm font-medium text-slate-600"
                >Моя сумма в грн<input
                  :value="money(myNumber)"
                  readonly
                  class="mt-1 block w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 font-semibold text-slate-700"
              /></label>
              <label class="text-sm font-medium text-slate-600"
                >Сторно<input
                  v-model="adjustmentUah"
                  :disabled="isGuest"
                  class="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"
                  inputmode="decimal"
                  placeholder="+/- 0,00"
                  @keydown.enter.prevent="adjustmentUah = committedNumericValue(adjustmentUah)"
              /></label>
              <label class="text-sm font-medium text-slate-600"
                >Моя сумма после сторно<input
                  :value="money(myNumberAfterAdjustment)"
                  readonly
                  class="mt-1 block w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 font-semibold text-slate-700"
              /></label>
            </div>
            <h3 class="mt-5 text-base font-bold">Новая сверка</h3>
            <div
              class="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-4"
            >
              <strong v-if="hasAccountingInput"
                >Не сходится: {{ money(discrepancy ?? 0) }} грн</strong
              >
              <strong v-else class="text-slate-500">Введите данные 1С</strong>
              <button
                :disabled="isGuest || isSaving || !hasAccountingInput"
                class="rounded-xl bg-emerald-700 px-4 py-2.5 font-semibold text-white disabled:opacity-50"
                @click="saveReconciliation"
              >
                {{ isSaving ? 'Сохраняем…' : 'Зафиксировать сверку' }}
              </button>
            </div>
          </section>

          <section class="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 class="text-lg font-bold">Платежи поставщику</h2>
            <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <input
                v-model="paymentDate"
                :disabled="isGuest || isSaving"
                class="rounded-lg border border-slate-300 px-3 py-2"
                type="date"
                aria-label="Дата платежа"
              />
              <input
                v-model="paymentTransferredUah"
                :disabled="isGuest || isSaving"
                class="rounded-lg border border-slate-300 px-3 py-2"
                inputmode="decimal"
                placeholder="Перечислено, грн"
                @keydown.enter.prevent="
                  paymentTransferredUah = committedNumericValue(paymentTransferredUah)
                "
              />
              <input
                v-model="paymentSupplierRate"
                :disabled="isGuest || isSaving"
                class="rounded-lg border border-slate-300 px-3 py-2"
                inputmode="decimal"
                placeholder="Курс поставщика"
                @keydown.enter.prevent="
                  paymentSupplierRate = committedNumericValue(paymentSupplierRate)
                "
              />
              <input
                v-model="paymentDebtUsd"
                :disabled="isGuest || isSaving"
                class="rounded-lg border border-slate-300 px-3 py-2"
                inputmode="decimal"
                placeholder="Закрыто USD"
                @keydown.enter.prevent="paymentDebtUsd = committedNumericValue(paymentDebtUsd)"
              />
              <input
                v-model="paymentDebtUah"
                :disabled="isGuest || isSaving"
                class="rounded-lg border border-slate-300 px-3 py-2"
                inputmode="decimal"
                placeholder="Закрыто грн"
                @keydown.enter.prevent="paymentDebtUah = committedNumericValue(paymentDebtUah)"
              />
              <input
                v-model="paymentNote"
                :disabled="isGuest || isSaving"
                class="rounded-lg border border-slate-300 px-3 py-2"
                placeholder="Номер счёта или комментарий"
              />
            </div>
            <div
              class="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600"
            >
              <span
                >Расчётный эквивалент: {{ money(paymentDraftEquivalent) }} грн · разница:
                {{ money(paymentDraftDifference) }} грн</span
              >
              <button
                :disabled="isGuest || isSaving"
                class="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 font-semibold text-emerald-800 disabled:opacity-50"
                @click="addPayment"
              >
                Добавить
              </button>
            </div>
            <div v-if="payments.length" class="mt-4 divide-y divide-slate-200 text-sm">
              <div
                v-for="payment in payments"
                :key="payment.id"
                class="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <span>{{ payment.paid_at }}</span
                ><strong>Перечислено: {{ money(Number(payment.amount_uah)) }} грн</strong
                ><span class="text-slate-600">Курс: {{ money(Number(payment.supplier_rate)) }}</span
                ><span class="text-slate-600"
                  >Закрыто: ${{ money(Number(payment.debt_usd)) }} +
                  {{ money(Number(payment.debt_uah)) }} грн</span
                ><span class="text-slate-600"
                  >Экв.: {{ money(paymentEquivalent(payment)) }} грн · Δ
                  {{ money(Number(payment.amount_uah) - paymentEquivalent(payment)) }} грн</span
                ><span class="min-w-0 flex-1 text-slate-500">{{ payment.note || '—' }}</span>
                <button
                  v-if="!isGuest"
                  :disabled="isSaving"
                  class="rounded-lg px-2 py-1 text-rose-700 hover:bg-rose-50"
                  @click="deletePayment(payment)"
                >
                  Удалить
                </button>
              </div>
            </div>
            <p v-else class="mt-4 text-sm text-slate-500">Платежей поставщику пока нет.</p>
          </section>

          <section class="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 class="text-lg font-bold">История сверок</h2>
            <div v-if="history.length" class="mt-4 overflow-x-auto">
              <table class="w-full min-w-[72rem] text-left text-sm">
                <thead class="text-slate-500">
                  <tr>
                    <th class="pb-2">Дата</th>
                    <th class="pb-2">Тип</th>
                    <th class="pb-2">USD</th>
                    <th class="pb-2">Гривна</th>
                    <th class="pb-2">Курс</th>
                    <th class="pb-2">Мой экв., грн</th>
                    <th class="pb-2">USD 1С</th>
                    <th class="pb-2">Грн 1С</th>
                    <th class="pb-2">Всего 1С</th>
                    <th class="pb-2">Бронь</th>
                    <th class="pb-2">Сторно</th>
                    <th class="pb-2">Расхождение</th>
                    <th v-if="!isGuest" class="pb-2"><span class="sr-only">Действия</span></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in history" :key="item.id" class="border-t border-slate-100">
                    <td class="py-2">{{ dateTime(item.reconciled_at) }}</td>
                    <td class="py-2 font-semibold">
                      {{ item.kind === 'initial' ? 'Начальное сальдо' : 'Сверка' }}
                    </td>
                    <td class="py-2">
                      {{ money(Number(item.crm_balance_usd_after_adjustment)) }}
                    </td>
                    <td class="py-2">
                      {{ money(Number(item.crm_balance_uah_after_adjustment)) }}
                    </td>
                    <td class="py-2">{{ money(Number(item.usd_rate)) }}</td>
                    <td class="py-2 font-semibold">
                      {{ money(reconciliationTotal(item)) }}
                    </td>
                    <td class="py-2">
                      {{ item.kind === 'initial' ? '—' : money(Number(item.accounting_usd)) }}
                    </td>
                    <td class="py-2">
                      {{ item.kind === 'initial' ? '—' : money(Number(item.accounting_uah)) }}
                    </td>
                    <td class="py-2">
                      {{ item.kind === 'initial' ? '—' : money(accountingTotalForHistory(item)) }}
                    </td>
                    <td class="py-2">
                      {{ item.kind === 'initial' ? '—' : money(Number(item.reserve_uah)) }}
                    </td>
                    <td class="py-2">
                      {{ item.kind === 'initial' ? '—' : money(Number(item.adjustment_uah)) }}
                    </td>
                    <td class="py-2">
                      {{ item.kind === 'initial' ? '—' : money(Number(item.discrepancy_uah)) }}
                    </td>
                    <td v-if="!isGuest" class="py-2 text-right">
                      <button
                        v-if="item.id === latestReconciliation?.id"
                        :disabled="isSaving"
                        class="rounded-lg px-2 py-1 text-rose-700 hover:bg-rose-50"
                        @click="deleteLatestReconciliation"
                      >
                        Удалить последнюю
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else class="mt-4 text-sm text-slate-500">Зафиксированных сверок пока нет.</p>
          </section>
        </template>
      </template>
    </div>
  </main>
</template>
