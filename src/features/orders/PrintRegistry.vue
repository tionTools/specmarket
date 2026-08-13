<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'

import PlatformLogo from '@/components/ui/PlatformLogo.vue'
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

function handleCheckedChange(order: Order, event: Event) {
  emit('checkedChange', order, (event.target as HTMLInputElement).checked)
}

function handleCheckAllChange(event: Event) {
  emit('checkAll', (event.target as HTMLInputElement).checked)
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
          class="grid gap-3 p-4 sm:grid-cols-[2.5rem_9rem_9rem_minmax(18rem,1fr)_10rem] sm:items-start"
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
            <p class="mt-1 text-xs font-semibold text-slate-600">{{ order.status }}</p>
          </div>
          <div class="min-w-0">
            <div v-for="product in order.products" :key="product.id" class="mb-2 last:mb-0">
              <p class="font-semibold">
                {{ product.name }}<span v-if="product.size"> · размер {{ product.size }}</span>
              </p>
              <p class="text-sm text-slate-600">
                {{ product.quantity }} × {{ formatMoney(product.price) }} =
                {{ formatMoney(product.quantity * product.price) }}
              </p>
            </div>
            <p class="mt-2 text-sm text-slate-600">
              {{ order.delivery.recipient }} · {{ order.delivery.recipientPhone }}
            </p>
            <p class="text-sm text-slate-600">
              {{ order.delivery.carrier }} · {{ order.delivery.ttn || 'ТТН нет' }}
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
        class="print-registry-actions sticky bottom-0 flex flex-wrap justify-end gap-3 border-t border-slate-300 bg-white/95 p-5 backdrop-blur"
      >
        <button
          class="rounded-xl bg-emerald-700 px-5 py-3 font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          :disabled="busy || checkedCount === 0"
          @click="emit('markPrinted')"
        >
          {{ busy ? 'Сохраняем…' : `Уже распечатал выбранные (${checkedCount})` }}
        </button>
      </footer>
    </section>
  </div>
</template>
