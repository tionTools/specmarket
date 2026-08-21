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
  crm_balance_before_adjustment: number
  adjustment_uah: number
  crm_balance_after_adjustment: number
  discrepancy_uah: number
  cost_snapshot_uah: number
  created_at: string
}

type SupplierPayment = {
  id: string
  paid_at: string
  amount_uah: number
  note: string | null
  created_at: string
}

type OrderCost = {
  status: string
  crm_order_items: Array<{ cost: number; quantity: number }>
}

const router = useRouter()
const reconciliations = ref<Reconciliation[]>([])
const payments = ref<SupplierPayment[]>([])
const usdRate = ref(0)
const currentCost = ref(0)
const isGuest = ref(false)
const isLoading = ref(true)
const isSaving = ref(false)
const notice = ref('')
const error = ref('')

const initialDate = ref(new Date().toISOString().slice(0, 10))
const initialBalance = ref('')
const paymentDate = ref(new Date().toISOString().slice(0, 10))
const paymentAmount = ref('')
const paymentNote = ref('')
const accountingUsd = ref('')
const accountingUah = ref('')
const reserveUah = ref('')
const adjustmentUah = ref('')

function numberValue(value: string) {
  const result = Number(value.replace(',', '.'))
  return Number.isFinite(result) ? result : 0
}

function money(value: number) {
  return new Intl.NumberFormat('uk-UA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat('uk-UA', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(value),
  )
}

function isCancelledOrReturned(status: string) {
  return /скас|отмен|cancel|повер|возврат|return|refund/.test(status.toLowerCase())
}

const latestCheckpoint = computed(() => reconciliations.value.at(0) ?? null)
const paymentsAfterCheckpoint = computed(() => {
  const checkpoint = latestCheckpoint.value
  if (!checkpoint) return 0
  const checkpointCreatedAt = Date.parse(checkpoint.created_at)
  return payments.value
    .filter((payment) => Date.parse(payment.created_at) > checkpointCreatedAt)
    .reduce((total, payment) => total + Number(payment.amount_uah), 0)
})
const myNumber = computed(() => {
  const checkpoint = latestCheckpoint.value
  if (!checkpoint) return 0
  return (
    Number(checkpoint.crm_balance_after_adjustment) +
    (currentCost.value - Number(checkpoint.cost_snapshot_uah)) -
    paymentsAfterCheckpoint.value
  )
})
const accountingTotal = computed(
  () => numberValue(accountingUsd.value) * usdRate.value + numberValue(accountingUah.value),
)
const myNumberAfterAdjustment = computed(() => myNumber.value + numberValue(adjustmentUah.value))
const discrepancy = computed(
  () => accountingTotal.value - numberValue(reserveUah.value) - myNumberAfterAdjustment.value,
)
const history = computed(() =>
  reconciliations.value.filter((item) => item.kind === 'reconciliation'),
)

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
  const [settingsResult, reconciliationsResult, paymentsResult, ordersResult] = await Promise.all([
    supabase.from('crm_settings').select('numeric_value').eq('key', 'usd_rate').maybeSingle(),
    supabase.from('crm_reconciliations').select('*').order('created_at', { ascending: false }),
    supabase.from('crm_supplier_payments').select('*').order('paid_at', { ascending: false }),
    supabase.from('crm_orders').select('status, crm_order_items(cost, quantity)'),
  ])
  if (
    settingsResult.error ||
    reconciliationsResult.error ||
    paymentsResult.error ||
    ordersResult.error
  ) {
    error.value = [
      settingsResult.error,
      reconciliationsResult.error,
      paymentsResult.error,
      ordersResult.error,
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
  currentCost.value = ((ordersResult.data as OrderCost[]) ?? [])
    .filter((order) => !isCancelledOrReturned(order.status))
    .reduce(
      (total, order) =>
        total +
        (order.crm_order_items ?? []).reduce(
          (orderTotal, item) => orderTotal + Number(item.cost) * Number(item.quantity),
          0,
        ),
      0,
    )
  isLoading.value = false
}

async function saveInitialBalance() {
  if (!supabase || isGuest.value || latestCheckpoint.value) return
  const balance = numberValue(initialBalance.value)
  if (!initialDate.value || !Number.isFinite(balance)) {
    error.value = 'Укажите дату и начальное сальдо.'
    return
  }
  isSaving.value = true
  error.value = ''
  const { error: saveError } = await supabase.from('crm_reconciliations').insert({
    kind: 'initial',
    reconciled_at: new Date(`${initialDate.value}T12:00:00`).toISOString(),
    crm_balance_before_adjustment: balance,
    crm_balance_after_adjustment: balance,
    cost_snapshot_uah: currentCost.value,
  })
  isSaving.value = false
  if (saveError) {
    error.value = saveError.message
    return
  }
  notice.value = 'Начальное сальдо и snapshot себестоимости зафиксированы.'
  await load()
}

async function addPayment() {
  const amount = numberValue(paymentAmount.value)
  if (!supabase || isGuest.value || !latestCheckpoint.value || !paymentDate.value || amount <= 0) {
    error.value = 'Укажите дату и сумму платежа больше нуля.'
    return
  }
  isSaving.value = true
  error.value = ''
  const { error: saveError } = await supabase.from('crm_supplier_payments').insert({
    paid_at: paymentDate.value,
    amount_uah: amount,
    note: paymentNote.value.trim() || null,
  })
  isSaving.value = false
  if (saveError) {
    error.value = saveError.message
    return
  }
  paymentAmount.value = ''
  paymentNote.value = ''
  await load()
}

async function deletePayment(payment: SupplierPayment) {
  if (!supabase || isGuest.value || !window.confirm('Удалить этот платёж?')) return
  const { error: deleteError } = await supabase
    .from('crm_supplier_payments')
    .delete()
    .eq('id', payment.id)
  if (deleteError) {
    error.value = deleteError.message
    return
  }
  await load()
}

async function saveReconciliation() {
  if (!supabase || isGuest.value || !latestCheckpoint.value) return
  isSaving.value = true
  error.value = ''
  const { error: saveError } = await supabase.from('crm_reconciliations').insert({
    kind: 'reconciliation',
    usd_rate: usdRate.value,
    accounting_usd: numberValue(accountingUsd.value),
    accounting_uah: numberValue(accountingUah.value),
    accounting_total: accountingTotal.value,
    reserve_uah: numberValue(reserveUah.value),
    crm_balance_before_adjustment: myNumber.value,
    adjustment_uah: numberValue(adjustmentUah.value),
    crm_balance_after_adjustment: myNumberAfterAdjustment.value,
    discrepancy_uah: discrepancy.value,
    cost_snapshot_uah: currentCost.value,
  })
  isSaving.value = false
  if (saveError) {
    error.value = saveError.message
    return
  }
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
          v-if="!latestCheckpoint"
          class="mt-5 max-w-xl rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm"
        >
          <h2 class="text-lg font-bold text-amber-950">Начальное сальдо</h2>
          <p class="mt-1 text-sm text-amber-900">
            Это разовая точка отсчёта. Текущая сумма себестоимостей CRM сохранится вместе с ней.
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
              >Реальное сальдо, грн<input
                v-model="initialBalance"
                :disabled="isGuest || isSaving"
                class="mt-1 block w-full rounded-lg border border-amber-200 bg-white px-3 py-2"
                inputmode="decimal"
                placeholder="0,00"
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
                <h2 class="text-lg font-bold">Текущая сверка</h2>
                <p class="mt-1 text-sm text-slate-500">
                  Курс берётся из раздела «Цены». Сумма себестоимостей CRM:
                  {{ money(currentCost) }} грн.
                </p>
              </div>
              <strong class="rounded-xl bg-emerald-50 px-3 py-2 text-emerald-900"
                >Моя цифра: {{ money(myNumber) }} грн</strong
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
                >Доллары<input
                  v-model="accountingUsd"
                  :disabled="isGuest"
                  class="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"
                  inputmode="decimal"
                  placeholder="0,00"
              /></label>
              <label class="text-sm font-medium text-slate-600"
                >Гривна<input
                  v-model="accountingUah"
                  :disabled="isGuest"
                  class="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"
                  inputmode="decimal"
                  placeholder="0,00"
              /></label>
              <label class="text-sm font-medium text-slate-600"
                >Всего 1С<input
                  :value="money(accountingTotal)"
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
              /></label>
              <label class="text-sm font-medium text-slate-600"
                >Моя цифра<input
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
              /></label>
              <label class="text-sm font-medium text-slate-600"
                >Моя цифра после сторно<input
                  :value="money(myNumberAfterAdjustment)"
                  readonly
                  class="mt-1 block w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 font-semibold text-slate-700"
              /></label>
            </div>
            <div
              class="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-4"
            >
              <strong>Не сходится: {{ money(discrepancy) }} грн</strong>
              <button
                :disabled="isGuest || isSaving"
                class="rounded-xl bg-emerald-700 px-4 py-2.5 font-semibold text-white disabled:opacity-50"
                @click="saveReconciliation"
              >
                {{ isSaving ? 'Сохраняем…' : 'Зафиксировать сверку' }}
              </button>
            </div>
          </section>

          <section class="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 class="text-lg font-bold">Платежи поставщику</h2>
            <div class="mt-4 grid gap-3 sm:grid-cols-[10rem_10rem_minmax(0,1fr)_auto]">
              <input
                v-model="paymentDate"
                :disabled="isGuest || isSaving"
                class="rounded-lg border border-slate-300 px-3 py-2"
                type="date"
                aria-label="Дата платежа"
              />
              <input
                v-model="paymentAmount"
                :disabled="isGuest || isSaving"
                class="rounded-lg border border-slate-300 px-3 py-2"
                inputmode="decimal"
                placeholder="Сумма, грн"
              />
              <input
                v-model="paymentNote"
                :disabled="isGuest || isSaving"
                class="rounded-lg border border-slate-300 px-3 py-2"
                placeholder="Номер счёта или комментарий"
              />
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
                ><strong>{{ money(Number(payment.amount_uah)) }} грн</strong
                ><span class="min-w-0 flex-1 text-slate-500">{{ payment.note || '—' }}</span>
                <button
                  v-if="!isGuest"
                  class="rounded-lg px-2 py-1 text-rose-700 hover:bg-rose-50"
                  @click="deletePayment(payment)"
                >
                  Удалить
                </button>
              </div>
            </div>
            <p v-else class="mt-4 text-sm text-slate-500">Платежей после точки сверки пока нет.</p>
          </section>

          <section class="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 class="text-lg font-bold">История сверок</h2>
            <div v-if="history.length" class="mt-4 overflow-x-auto">
              <table class="w-full min-w-[34rem] text-left text-sm">
                <thead class="text-slate-500">
                  <tr>
                    <th class="pb-2">Дата</th>
                    <th class="pb-2">Итоговое сальдо</th>
                    <th class="pb-2">Сторно</th>
                    <th class="pb-2">Расхождение</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in history" :key="item.id" class="border-t border-slate-100">
                    <td class="py-2">{{ dateTime(item.reconciled_at) }}</td>
                    <td class="py-2 font-semibold">
                      {{ money(Number(item.crm_balance_after_adjustment)) }}
                    </td>
                    <td class="py-2">{{ money(Number(item.adjustment_uah)) }}</td>
                    <td class="py-2">{{ money(Number(item.discrepancy_uah)) }}</td>
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
