<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'

import CarrierLogo from '@/components/ui/CarrierLogo.vue'
import PlatformLogo from '@/components/ui/PlatformLogo.vue'
import { displayCarrier } from '@/features/orders/display'
import type { Order } from '@/features/orders/types'

const props = defineProps<{
  orders: Order[]
  mode: 'draft' | 'history'
  busy: boolean
}>()

const emit = defineEmits<{
  close: []
  markPrinted: []
  showHistory: []
  showDraft: []
  checkedChange: [order: Order, checked: boolean]
  checkAll: [checked: boolean]
  restore: [order: Order]
  restoreUnchecked: []
}>()

const checkedCount = computed(
  () => props.orders.filter((order) => Boolean(order.delivery.printCheckedAt)).length,
)
const allChecked = computed(
  () => props.orders.length > 0 && checkedCount.value === props.orders.length,
)
const uncheckedPrintedCount = computed(
  () =>
    props.orders.filter((order) => order.delivery.printedAt && !order.delivery.printCheckedAt)
      .length,
)
const positionsCount = computed(() =>
  props.orders.reduce(
    (total, order) =>
      total + order.products.reduce((orderTotal, product) => orderTotal + product.quantity, 0),
    0,
  ),
)
const totalAmount = computed(() =>
  props.orders.reduce(
    (total, order) =>
      total +
      order.products.reduce(
        (orderTotal, product) => orderTotal + product.price * product.quantity,
        0,
      ),
    0,
  ),
)
function formatMoney(value: number) {
  return `${new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 }).format(value)} ₴`
}

function formatUsd(value: number) {
  return `${new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 }).format(value)} $`
}

function orderCostUsd(order: Order) {
  return order.products.reduce(
    (total, product) => total + (product.costUsd ?? 0) * product.quantity,
    0,
  )
}

function orderCostUah(order: Order) {
  return order.products.reduce((total, product) => total + product.cost * product.quantity, 0)
}

function displayOrderStatus(status: string) {
  const names: Record<string, string> = {
    pending: 'Новий',
    new: 'Новий',
    received: 'Прийнято',
    delivered: 'Виконано',
    completed: 'Завершено',
    confirmed_by_seller: 'Підтверджено продавцем',
    confirmed_by_merchant: 'Підтверджено продавцем',
    confirmed: 'Підтверджено',
    sent: 'Відправлено',
    ready_for_pickup: 'Готово до видачі',
    finished: 'Завершено',
    closed: 'Закрито',
    canceled: 'Скасовано',
    cancelled: 'Скасовано',
    returned: 'Повернено',
    return_request: 'Запит на повернення',
    canceled_by_seller: 'Скасовано продавцем',
    canceled_by_merchant: 'Скасовано продавцем',
  }
  return names[status.toLowerCase()] ?? status
}

function handleCheckedChange(order: Order, event: Event) {
  emit('checkedChange', order, (event.target as HTMLInputElement).checked)
}

function handleCheckAllChange(event: Event) {
  emit('checkAll', (event.target as HTMLInputElement).checked)
}

function carrierLogoKind(order: Order) {
  const carrier = order.delivery.carrier.toLowerCase()
  const address = order.delivery.address.toLowerCase()
  const isEpicentrDelivery = order.platform === 'Эпицентр'
  if (isEpicentrDelivery && (carrier.includes('cvz') || /центр видачі|центр выдачи/.test(address)))
    return 'meest-epicentr-cvz'
  if (
    isEpicentrDelivery &&
    (carrier.includes('meest') || carrier.includes('міст') || carrier.includes('parcel_box'))
  )
    return 'meest-pachtmate'
  if (carrier.includes('nova') || carrier.includes('новая') || carrier.includes('нова пошта'))
    return 'nova'
  if (carrier.includes('ukr') || carrier.includes('укр')) return 'ukr'
  if (carrier.includes('rozetka')) return 'rozetka'
  if (carrier.includes('meest') || carrier.includes('міст')) return 'meest'
  return ''
}

let previousBodyOverflow = ''
onMounted(() => {
  previousBodyOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
})
onUnmounted(() => {
  document.body.style.overflow = previousBodyOverflow
})
</script>

<template>
  <div class="print-registry-overlay fixed inset-0 z-[70] overflow-y-auto bg-slate-100 p-4 sm:p-7">
    <section
      class="print-registry mx-auto max-w-7xl rounded-2xl border border-slate-300 bg-white shadow-xl"
    >
      <header class="border-b border-slate-300 p-5 sm:p-6">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p class="text-xs font-bold tracking-[0.16em] text-emerald-700">SPECMARKET CRM</p>
            <h1 class="mt-1 text-2xl font-bold">
              {{ mode === 'draft' ? 'Реестр печати' : 'История печати' }}
            </h1>
            <p v-if="mode === 'draft'" class="mt-2 text-sm text-slate-600">
              Проверьте каждый заказ в 1С. Новые заказы, пришедшие сейчас, попадут в следующий
              реестр.
            </p>
          </div>
          <div class="print-registry-actions flex flex-wrap gap-2">
            <button
              v-if="mode === 'draft'"
              class="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50"
              type="button"
              @click="emit('showHistory')"
            >
              История
            </button>
            <button
              v-else
              class="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50"
              type="button"
              @click="emit('showDraft')"
            >
              Текущий реестр
            </button>
            <button
              v-if="mode === 'history' && uncheckedPrintedCount"
              class="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100"
              type="button"
              :disabled="busy"
              @click="emit('restoreUnchecked')"
            >
              Вернуть без галочки ({{ uncheckedPrintedCount }})
            </button>
            <button
              class="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50"
              type="button"
              @click="emit('close')"
            >
              Закрыть
            </button>
          </div>
        </div>
        <div class="mt-5 grid gap-3 sm:grid-cols-4">
          <div class="rounded-xl bg-slate-100 px-4 py-3">
            <p class="text-xs text-slate-500">Заказов</p>
            <p class="mt-1 text-xl font-bold">{{ orders.length }}</p>
          </div>
          <div class="rounded-xl bg-slate-100 px-4 py-3">
            <p class="text-xs text-slate-500">Единиц товара</p>
            <p class="mt-1 text-xl font-bold">{{ positionsCount }}</p>
          </div>
          <div class="rounded-xl bg-slate-100 px-4 py-3">
            <p class="text-xs text-slate-500">Общая сумма</p>
            <p class="mt-1 text-xl font-bold">{{ formatMoney(totalAmount) }}</p>
          </div>
          <div class="rounded-xl bg-slate-100 px-4 py-3">
            <p class="text-xs text-slate-500">Проверено в 1С</p>
            <p class="mt-1 text-xl font-bold">{{ checkedCount }} / {{ orders.length }}</p>
            <label
              v-if="mode === 'draft' && orders.length"
              class="mt-2 inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-emerald-800"
            >
              <input
                class="size-4 accent-emerald-700"
                type="checkbox"
                :checked="allChecked"
                :disabled="busy"
                @change="handleCheckAllChange"
              />
              {{ allChecked ? 'Снять все' : 'Отметить все' }}
            </label>
          </div>
        </div>
      </header>

      <div v-if="orders.length" class="divide-y divide-slate-300">
        <article
          v-for="order in orders"
          :key="order.id"
          class="grid gap-3 p-4 sm:grid-cols-[2.5rem_8rem_8rem_minmax(30rem,1fr)_8rem] sm:items-start"
        >
          <label v-if="mode === 'draft'" class="print-registry-actions pt-1">
            <input
              class="size-5 accent-emerald-700"
              type="checkbox"
              :checked="Boolean(order.delivery.printCheckedAt)"
              :disabled="busy"
              aria-label="Проверено в 1С"
              @change="handleCheckedChange(order, $event)"
            />
          </label>
          <span v-else class="hidden sm:block" />
          <div>
            <p class="font-bold">{{ order.displayNumber ?? order.id }}</p>
            <p class="mt-1 text-xs text-slate-500">{{ order.date }} · {{ order.time || '—' }}</p>
          </div>
          <div>
            <PlatformLogo :platform="order.platform" />
            <p class="mt-1 text-xs font-semibold text-slate-600">
              {{ displayOrderStatus(order.status) }}
            </p>
          </div>
          <div class="min-w-0">
            <div
              v-for="product in order.products"
              :key="product.id"
              class="mb-3 grid min-w-0 grid-cols-[3.5rem_minmax(10rem,1fr)_3.5rem_5.5rem_5.5rem_6rem] items-center gap-2 border-b border-slate-200 pb-3 last:mb-0 last:border-0 last:pb-0"
            >
              <div
                class="flex size-14 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
              >
                <img
                  v-if="product.imageUrl"
                  :src="product.imageUrl"
                  :alt="product.name"
                  class="size-full object-contain"
                  loading="lazy"
                />
                <span v-else class="text-[10px] font-semibold text-slate-400">Нет фото</span>
              </div>
              <div class="min-w-0">
                <p class="font-semibold leading-snug">{{ product.name }}</p>
                <p
                  v-if="product.size"
                  class="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 text-sm font-semibold text-violet-700"
                >
                  <span class="text-xs uppercase tracking-wide">Размер</span>
                  <strong class="text-base leading-none text-violet-950">{{ product.size }}</strong>
                </p>
              </div>
              <div>
                <p class="text-[10px] font-semibold uppercase text-slate-500">Кол.</p>
                <p class="mt-1 font-semibold">{{ product.quantity }}</p>
              </div>
              <div>
                <p class="text-[10px] font-semibold uppercase text-slate-500">Цена, ₴</p>
                <p class="mt-1 font-semibold">{{ formatMoney(product.price) }}</p>
              </div>
              <div>
                <p class="text-[10px] font-semibold uppercase text-emerald-700">С/С $</p>
                <p class="mt-1 font-semibold">{{ product.costUsd ?? 0 }}</p>
              </div>
              <div>
                <p class="text-[10px] font-semibold uppercase text-rose-700">С/С ₴</p>
                <p class="mt-1 font-semibold">{{ formatMoney(product.cost) }}</p>
              </div>
              <p class="col-span-full text-xs font-medium text-slate-600">
                Итого себест.:
                <span v-if="product.costUsd" class="text-emerald-800">
                  {{ formatUsd(product.costUsd * product.quantity) }} ·
                </span>
                <span class="text-rose-800">{{
                  formatMoney(product.cost * product.quantity)
                }}</span>
              </p>
            </div>
            <div
              class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-200 pt-3 text-sm font-semibold"
            >
              <span>Итого по заказу, себест.:</span>
              <span v-if="orderCostUsd(order)" class="text-emerald-800">
                {{ formatUsd(orderCostUsd(order)) }}
              </span>
              <span class="text-rose-800">{{ formatMoney(orderCostUah(order)) }}</span>
            </div>
            <p class="mt-2 text-sm text-slate-600">
              {{ order.delivery.recipient }} · {{ order.delivery.recipientPhone }}
            </p>
            <p class="flex items-center gap-1 text-sm text-slate-600">
              <span>{{ displayCarrier(order.delivery.carrier) }} ·</span>
              <CarrierLogo v-if="carrierLogoKind(order)" :kind="carrierLogoKind(order)" />
              <span class="font-bold text-blue-600">{{ order.delivery.ttn }}</span>
            </p>
            <p v-if="order.internalComment" class="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-sm">
              {{ order.internalComment }}
            </p>
          </div>
          <div class="text-right">
            <p class="text-lg font-bold">
              {{
                formatMoney(
                  order.products.reduce(
                    (sum, product) => sum + product.price * product.quantity,
                    0,
                  ),
                )
              }}
            </p>
            <p v-if="order.delivery.printedAt" class="mt-1 text-xs text-slate-500">
              {{ new Date(order.delivery.printedAt).toLocaleString('uk-UA') }}
            </p>
            <button
              v-if="mode === 'history'"
              class="print-registry-actions mt-2 rounded-lg border border-amber-300 px-3 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-50"
              type="button"
              :disabled="busy"
              @click="emit('restore', order)"
            >
              Вернуть
            </button>
          </div>
        </article>
      </div>
      <p v-else class="p-10 text-center text-slate-500">
        {{ mode === 'draft' ? 'Нераспечатанных активных заказов нет.' : 'История пока пуста.' }}
      </p>

      <footer
        v-if="mode === 'draft' && orders.length"
        class="print-registry-actions pointer-events-none sticky bottom-3 z-10 flex justify-end p-3"
      >
        <div
          class="pointer-events-auto rounded-2xl border border-slate-200 bg-white/95 p-2 shadow-lg backdrop-blur"
        >
          <button
            class="rounded-xl bg-emerald-700 px-5 py-3 font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            :disabled="busy || checkedCount === 0"
            @click="emit('markPrinted')"
          >
            {{ busy ? 'Сохраняем…' : `Уже распечатал выбранные (${checkedCount})` }}
          </button>
        </div>
      </footer>
    </section>
  </div>
</template>
