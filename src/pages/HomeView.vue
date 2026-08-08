<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useTemplateRef } from 'vue'
import type { User } from '@supabase/supabase-js'

import { demoOrders } from '@/features/orders/demoOrders'
import type { Delivery, Order, OrderProduct, Platform } from '@/features/orders/types'
import { supabase } from '@/lib/supabase'

const storageKey = 'specmarket-crm-demo-orders'
const orderDialog = useTemplateRef<HTMLDialogElement>('orderDialog')
const searchQuery = ref('')
const platformFilter = ref<'all' | Platform>('all')
const expandedOrderId = ref<number | null>(null)
const user = ref<User | null>(null)
const email = ref('')
const password = ref('')
const authError = ref('')
const isSigningIn = ref(false)
const editingOrderCell = ref<string | null>(null)

const platformOptions: Platform[] = ['Пром', 'Эпик', 'Каста', 'Р/С', 'Сайт']
const carrierOptions: Delivery['carrier'][] = [
  'Новая почта',
  'Укрпочта',
  'RozetkaDelivery',
  'Meest',
]
const statusOptions: Record<Platform, string[]> = {
  Пром: ['Новий', 'Прийнято', 'Виконано', 'Оплачено', 'Скасовано'],
  Эпик: [
    'Новий',
    'Підтверджено продавцем',
    'Підтверджено',
    'Відправлено',
    'Готово до видачі',
    'Завершено',
    'Закрито',
    'Скасовано',
    'Повернено',
    'Запит на повернення',
    'Скасовано продавцем',
  ],
  Каста: ['В дороге', 'Закрыт', 'Возврат'],
  'Р/С': ['В дороге', 'Закрыт', 'Возврат'],
  Сайт: ['В дороге', 'Закрыт', 'Возврат'],
}

const storedOrders = window.localStorage.getItem(storageKey)
const orders = ref<Order[]>(
  storedOrders
    ? (JSON.parse(storedOrders) as Order[]).map((order) => ({
        ...order,
        delivery: {
          ...order.delivery,
          recipient: order.delivery.recipient || order.customer,
          recipientPhone: order.delivery.recipientPhone || order.phone,
        },
      }))
    : demoOrders,
)

const todayKey = () => new Intl.DateTimeFormat('uk-UA').format(new Date())
const orderDraft = ref(createOrderDraft())
const currentMonth = () => {
  const now = new Date()
  return { month: now.getMonth() + 1, year: now.getFullYear() }
}

const getOrderAmount = (order: Order) =>
  order.products.reduce((sum, product) => sum + product.price * product.quantity, 0)
const getOrderCost = (order: Order) =>
  order.products.reduce((sum, product) => sum + product.cost * product.quantity, 0)
const getProductRoyalty = (order: Order, product: OrderProduct) => {
  const percent = product.royaltyPercent ?? (order.platform === 'Каста' ? 22 : 0)
  return product.royaltyAmount ?? product.price * product.quantity * (percent / 100)
}
const getRoyalty = (order: Order) =>
  order.products.reduce((sum, product) => sum + getProductRoyalty(order, product), 0)
const getPlannedProfit = (order: Order) =>
  getOrderAmount(order) * 0.983 - getOrderCost(order) - getRoyalty(order) - order.shipping
const isPaid = (order: Order) =>
  ['Оплачено', 'Виконано', 'Завершено', 'Закрито', 'Закрыт'].includes(order.status)
const getActualProfit = (order: Order) =>
  getOrderAmount(order) - getOrderCost(order) - getRoyalty(order) - order.shipping - order.acquiring
const formatMoney = (value: number) =>
  new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 }).format(value) + ' ₴'
const formatOrderNumber = (value: number | undefined) => {
  if (value === undefined) return ''
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace('.', ',')
}

const isInCurrentMonth = (order: Order) => {
  const [day, month, year] = order.date.split('.').map(Number)
  const current = currentMonth()
  return day !== undefined && month === current.month && year === current.year
}

const ordersForToday = computed(() => orders.value.filter((order) => order.date === todayKey()))
const ordersForMonth = computed(() => orders.value.filter(isInCurrentMonth))
const visibleOrders = computed(() => {
  const search = searchQuery.value.trim().toLowerCase()
  return orders.value.filter((order) => {
    const matchesPlatform =
      platformFilter.value === 'all' || order.platform === platformFilter.value
    const haystack =
      `${order.id} ${order.customer} ${order.phone} ${order.products.map((product) => product.name).join(' ')}`.toLowerCase()
    return matchesPlatform && (!search || haystack.includes(search))
  })
})

const summary = computed(() => {
  const sum = (items: Order[], getter: (order: Order) => number) =>
    items.reduce((total, order) => total + getter(order), 0)
  return {
    today: {
      orders: ordersForToday.value.length,
      turnover: sum(ordersForToday.value, getOrderAmount),
      planned: sum(ordersForToday.value, getPlannedProfit),
      actual: sum(ordersForToday.value.filter(isPaid), getActualProfit),
    },
    month: {
      orders: ordersForMonth.value.length,
      turnover: sum(ordersForMonth.value, getOrderAmount),
      planned: sum(ordersForMonth.value, getPlannedProfit),
      actual: sum(ordersForMonth.value.filter(isPaid), getActualProfit),
    },
  }
})

const platformSummary = computed(() =>
  platformOptions.map((platform) => {
    const platformOrders = ordersForMonth.value.filter((order) => order.platform === platform)
    return {
      platform,
      count: platformOrders.length,
      turnover: platformOrders.reduce((sum, order) => sum + getOrderAmount(order), 0),
      planned: platformOrders.reduce((sum, order) => sum + getPlannedProfit(order), 0),
      actual: platformOrders.filter(isPaid).reduce((sum, order) => sum + getActualProfit(order), 0),
    }
  }),
)

function createProduct(): OrderProduct {
  return { id: crypto.randomUUID(), name: '', size: '', quantity: 1, price: 0, cost: 0 }
}

function createOrderDraft(): Order {
  return {
    id: Math.max(0, ...orders.value.map((order) => order.id)) + 1,
    date: todayKey(),
    customer: '',
    phone: '',
    platform: 'Пром',
    status: 'Новий',
    products: [createProduct()],
    shipping: 0,
    acquiring: 0,
    delivery: {
      carrier: 'Новая почта',
      ttn: '',
      recipient: '',
      recipientPhone: '',
      city: '',
      address: '',
      status: 'Запланировано',
      payer: 'Получатель',
    },
  }
}

async function persistOrders() {
  window.localStorage.setItem(storageKey, JSON.stringify(orders.value))
  if (!supabase) return
  const { data: session } = await supabase.auth.getSession()
  if (!session.session) return
  for (const order of orders.value) {
    const payload = { order_number: order.id, order_date: order.date, customer: order.customer, phone: order.phone, platform: order.platform, status: order.status, shipping: order.shipping, acquiring: order.acquiring, acquiring_percent: order.acquiringPercent ?? null, delivery: order.delivery }
    let remoteId = order.remoteId
    if (remoteId) await supabase.from('crm_orders').update(payload).eq('id', remoteId)
    else { const { data } = await supabase.from('crm_orders').insert(payload).select('id').single(); remoteId = data?.id; if (remoteId) order.remoteId = remoteId }
    if (!remoteId) continue
    await supabase.from('crm_order_items').delete().eq('order_id', remoteId)
    await supabase.from('crm_order_items').insert(order.products.map((product, position) => ({ order_id: remoteId, position, product_name: product.name, size: product.size, quantity: product.quantity, price: product.price, cost: product.cost, royalty_percent: product.royaltyPercent ?? null, royalty_amount: product.royaltyAmount ?? null })))
  }
}

async function signIn() {
  if (!supabase) { authError.value = 'Supabase не настроен.'; return }
  isSigningIn.value = true
  authError.value = ''
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.value, password: password.value })
  isSigningIn.value = false
  if (error) { authError.value = error.message; return }
  user.value = data.user
  window.location.reload()
}

async function signOut() {
  await supabase?.auth.signOut()
  user.value = null
  window.location.reload()
}

onMounted(async () => {
  if (!supabase) return
  const { data: session } = await supabase.auth.getSession()
  if (!session.session) return
  user.value = session.session.user
  const { data: remoteOrders } = await supabase.from('crm_orders').select('*, crm_order_items(*)').order('created_at')
  if (!remoteOrders?.length) { await persistOrders(); return }
  orders.value = remoteOrders.map((row) => ({ id: row.order_number, remoteId: row.id, date: row.order_date, customer: row.customer, phone: row.phone, platform: row.platform as Platform, status: row.status, shipping: Number(row.shipping), acquiring: Number(row.acquiring), acquiringPercent: row.acquiring_percent === null ? undefined : Number(row.acquiring_percent), delivery: row.delivery as Delivery, products: (row.crm_order_items as Array<{ id: string; position: number; product_name: string; size: string | null; quantity: number; price: number; cost: number; royalty_percent: number | null; royalty_amount: number | null }>).sort((a, b) => a.position - b.position).map((item) => ({ id: item.id, name: item.product_name, size: item.size ?? '', quantity: Number(item.quantity), price: Number(item.price), cost: Number(item.cost), royaltyPercent: item.royalty_percent === null ? undefined : Number(item.royalty_percent), royaltyAmount: item.royalty_amount === null ? undefined : Number(item.royalty_amount) })) }))
})

function openNewOrderDialog() {
  orderDraft.value = createOrderDraft()
  orderDialog.value?.showModal()
}

function addProduct() {
  orderDraft.value.products.push(createProduct())
}

function removeProduct(productId: string) {
  if (orderDraft.value.products.length > 1) {
    orderDraft.value.products = orderDraft.value.products.filter(
      (product) => product.id !== productId,
    )
  }
}

function updateDraftPlatform() {
  const statuses = statusOptions[orderDraft.value.platform]
  if (!statuses.includes(orderDraft.value.status)) {
    orderDraft.value.status = statuses[0] ?? ''
  }
}

function createOrder() {
  orders.value.unshift(structuredClone(orderDraft.value))
  persistOrders()
  orderDialog.value?.close()
}

function updateOrderStatus(order: Order, status: string) {
  order.status = status
  persistOrders()
}

function toggleOrder(orderId: number) {
  expandedOrderId.value = expandedOrderId.value === orderId ? null : orderId
}

function platformClass(platform: Platform) {
  return {
    'text-blue-700': platform === 'Пром',
    'text-orange-600': platform === 'Каста',
    'text-emerald-700': platform === 'Эпик',
  }
}

function syncProductRoyaltyAmount(order: Order, product: OrderProduct) {
  product.royaltyAmount = product.price * product.quantity * ((product.royaltyPercent ?? 0) / 100)
  persistOrders()
}

function syncProductRoyaltyPercent(order: Order, product: OrderProduct) {
  const amount = product.price * product.quantity
  product.royaltyPercent = amount === 0 ? 0 : ((product.royaltyAmount ?? 0) / amount) * 100
  persistOrders()
}

function syncAcquiringAmount(order: Order) {
  order.acquiring = getOrderAmount(order) * ((order.acquiringPercent ?? 0) / 100)
  persistOrders()
}

function syncAcquiringPercent(order: Order) {
  const amount = getOrderAmount(order)
  order.acquiringPercent = amount === 0 ? 0 : (order.acquiring / amount) * 100
  persistOrders()
}

async function toggleOrderCell(key: string, event: KeyboardEvent) {
  if (editingOrderCell.value === key) {
    editingOrderCell.value = null
    persistOrders()
    return
  }
  editingOrderCell.value = key
  await nextTick()
  ;(event.target as HTMLInputElement).select()
}

function updateOrderNumber(product: OrderProduct, field: 'quantity' | 'price' | 'cost', event: Event) {
  const raw = (event.target as HTMLInputElement).value
  const value = Number(raw.replace(',', '.'))
  if (Number.isFinite(value)) product[field] = value
}

function finishOrderCell(key: string) {
  if (editingOrderCell.value === key) {
    editingOrderCell.value = null
    persistOrders()
  }
}
</script>

<template>
  <div v-if="!user" class="flex min-h-screen items-center justify-center bg-slate-50 p-4 text-slate-900">
    <form class="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-xl" @submit.prevent="signIn">
      <p class="text-xs font-bold tracking-[0.2em] text-emerald-700">SPECMARKET CRM</p>
      <h1 class="mt-3 text-3xl font-semibold">Вход в CRM</h1>
      <p class="mt-2 text-sm text-slate-500">Войди, чтобы увидеть общие заказы и цены на всех устройствах.</p>
      <input v-model="email" required class="mt-6 w-full rounded-xl border border-slate-200 px-3 py-3" placeholder="Email" type="email" />
      <input v-model="password" required class="mt-3 w-full rounded-xl border border-slate-200 px-3 py-3" placeholder="Пароль" type="password" />
      <p v-if="authError" class="mt-3 text-sm text-rose-700">{{ authError }}</p>
      <button class="mt-5 w-full rounded-xl bg-emerald-700 px-4 py-3 font-semibold text-white hover:bg-emerald-800" :disabled="isSigningIn" type="submit">{{ isSigningIn ? 'Входим…' : 'Войти' }}</button>
    </form>
  </div>
  <div v-else class="min-h-screen bg-slate-50 text-slate-900">
    <div class="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header class="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p class="text-xs font-bold tracking-[0.2em] text-emerald-700">SPECMARKET CRM</p>
          <h1 class="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Заказы</h1>
          <p
            class="mt-2 inline-flex rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800"
          >
            Демо-режим: данные сохраняются только в этом браузере
          </p>
        </div>
        <div class="flex flex-wrap gap-3">
          <button class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 shadow-sm hover:border-rose-200 hover:text-rose-700" type="button" @click="signOut">Выйти</button>
          <RouterLink
            class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-emerald-300 hover:text-emerald-800"
            to="/prices"
          >
            Цены
          </RouterLink>
          <button
            class="rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800"
            type="button"
            @click="openNewOrderDialog"
          >
            + Новый заказ
          </button>
        </div>
      </header>

      <section class="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p class="text-sm text-slate-500">Заказы</p>
          <p class="mt-2 text-3xl font-semibold">{{ summary.today.orders }}</p>
          <p class="mt-2 text-xs text-slate-500">
            За месяц: <span class="font-semibold text-slate-800">{{ summary.month.orders }}</span>
          </p>
        </article>
        <article class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p class="text-sm text-slate-500">Оборот</p>
          <p class="mt-2 text-3xl font-semibold">{{ formatMoney(summary.today.turnover) }}</p>
          <p class="mt-2 text-xs text-slate-500">
            За месяц:
            <span class="font-semibold text-slate-800">{{
              formatMoney(summary.month.turnover)
            }}</span>
          </p>
        </article>
        <article class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p class="text-sm text-slate-500">Плановая прибыль</p>
          <p class="mt-2 text-3xl font-semibold">{{ formatMoney(summary.today.planned) }}</p>
          <p class="mt-2 text-xs text-slate-500">
            За месяц:
            <span class="font-semibold text-slate-800">{{
              formatMoney(summary.month.planned)
            }}</span>
          </p>
        </article>
        <article class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p class="text-sm text-slate-500">Фактическая прибыль</p>
          <p class="mt-2 text-3xl font-semibold">{{ formatMoney(summary.today.actual) }}</p>
          <p class="mt-2 text-xs text-slate-500">
            За месяц:
            <span class="font-semibold text-slate-800">{{
              formatMoney(summary.month.actual)
            }}</span>
          </p>
        </article>
      </section>

      <section class="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p class="text-xs font-bold tracking-[0.16em] text-emerald-700">ТЕКУЩИЙ МЕСЯЦ</p>
            <h2 class="mt-1 text-xl font-semibold">По площадкам</h2>
          </div>
          <p class="text-xs text-slate-500">Оборот · План · Факт</p>
        </div>
        <div class="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <article
            v-for="item in platformSummary"
            :key="item.platform"
            class="rounded-xl bg-slate-50 p-4"
          >
            <p class="font-bold" :class="platformClass(item.platform)">{{ item.platform }}</p>
            <p class="mt-3 text-xs text-slate-500">Заказов: {{ item.count }}</p>
            <p class="text-xs text-slate-500">Оборот: {{ formatMoney(item.turnover) }}</p>
            <p class="text-xs text-slate-500">План: {{ formatMoney(item.planned) }}</p>
            <p class="text-xs text-slate-500">Факт: {{ formatMoney(item.actual) }}</p>
          </article>
        </div>
      </section>

      <section class="mt-6 rounded-2xl border border-slate-200 bg-slate-100 p-3 shadow-sm">
        <div class="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row">
          <input
            v-model="searchQuery"
            class="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none transition focus:border-emerald-600 sm:max-w-md"
            placeholder="Поиск: номер, покупатель, товар"
          /><select
            v-model="platformFilter"
            class="rounded-xl border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="all">Все площадки</option>
            <option v-for="platform in platformOptions" :key="platform" :value="platform">
              {{ platform }}
            </option>
          </select>
        </div>
        <div
          class="mt-3 hidden grid-cols-[0.75fr_0.9fr_1.6fr_0.95fr_0.95fr_1fr_1.1fr_1.5rem] gap-3 px-5 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 lg:grid"
        >
          <span>Номер заказа</span><span>Площадка<br />Статус</span><span>Товары</span
          ><span>Сумма заказа</span><span>Факт. прибыль</span><span>План. прибыль</span
          ><span>Состояние отгрузки</span><span />
        </div>
        <article
          v-for="order in visibleOrders"
          :key="order.id"
          class="mb-3 overflow-hidden rounded-xl border bg-white shadow-sm transition"
          :class="expandedOrderId === order.id ? 'border-emerald-300 ring-2 ring-emerald-100' : 'border-slate-200 hover:border-slate-300'"
        >
          <button
            class="grid w-full gap-3 px-5 py-4 text-left transition hover:bg-slate-50 lg:grid-cols-[0.75fr_0.9fr_1.6fr_0.95fr_0.95fr_1fr_1.1fr_1.5rem] lg:items-center"
            type="button"
            @click="toggleOrder(order.id)"
          >
            <span
              ><strong>№ {{ order.id }}</strong
              ><span class="mt-1 block text-xs text-slate-500">{{ order.date }}</span></span
            ><span
              ><strong :class="platformClass(order.platform)">{{ order.platform }}</strong
              ><span
                class="mt-1 block w-fit rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700"
                >{{ order.status }}</span
              ></span
            ><span class="truncate text-sm">{{
              order.products.map((product) => `${product.name} ×${product.quantity}`).join(', ')
            }}</span
            ><strong>{{ formatMoney(getOrderAmount(order)) }}</strong
            ><strong>{{ isPaid(order) ? formatMoney(getActualProfit(order)) : '—' }}</strong
            ><strong>{{ formatMoney(getPlannedProfit(order)) }}</strong
            ><span
              class="w-fit rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700"
              >{{ order.delivery.status }}</span
            ><span class="text-xl text-slate-400">{{
              expandedOrderId === order.id ? '⌄' : '›'
            }}</span>
          </button>
          <div
            v-if="expandedOrderId === order.id"
            class="grid gap-5 border-t border-emerald-100 bg-slate-50 p-5 lg:grid-cols-[minmax(0,1fr)_21rem]"
          >
            <section>
              <div class="flex flex-wrap items-center justify-between gap-3">
                <h3 class="text-base font-semibold">Состав заказа</h3>
                <label class="flex items-center gap-2 text-sm text-slate-500"
                  >Статус<select
                    :value="order.status"
                    class="rounded-lg border border-emerald-200 bg-white px-2 py-1 font-semibold text-emerald-800"
                    @change="updateOrderStatus(order, ($event.target as HTMLSelectElement).value)"
                  >
                    <option
                      v-for="status in statusOptions[order.platform]"
                      :key="status"
                      :value="status"
                    >
                      {{ status }}
                    </option>
                  </select></label
                >
              </div>
              <section class="mt-4 rounded-xl border border-slate-200 bg-white p-4">
                <h4 class="text-sm font-semibold">Данные покупателя</h4>
                <dl class="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt class="text-slate-500">Покупатель</dt>
                    <dd class="mt-1 font-semibold">{{ order.customer }}</dd>
                  </div>
                  <div>
                    <dt class="text-slate-500">Телефон покупателя</dt>
                    <dd class="mt-1 font-semibold">{{ order.phone }}</dd>
                  </div>
                </dl>
              </section>
              <div class="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div
                  v-for="product in order.products"
                  :key="product.id"
                  class="grid gap-3 border-b border-slate-100 p-4 last:border-b-0 sm:grid-cols-[minmax(0,2.4fr)_4.5rem_5.5rem_5.5rem_10rem] sm:items-end"
                >
                  <div><strong>{{ product.name }}</strong><span class="mt-1 block text-sm text-slate-500">Размер: {{ product.size }}</span></div>
                  <label class="text-xs font-medium text-slate-500">Количество<input :value="formatOrderNumber(product.quantity)" :readonly="editingOrderCell !== `${order.id}-${product.id}-quantity`" class="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-semibold text-slate-900" type="text" @input="updateOrderNumber(product, 'quantity', $event)" @blur="finishOrderCell(`${order.id}-${product.id}-quantity`)" @keydown.enter.prevent="toggleOrderCell(`${order.id}-${product.id}-quantity`, $event)" /></label>
                  <label class="text-xs font-medium text-slate-500">Продажа / ед., ₴<input :value="formatOrderNumber(product.price)" :readonly="editingOrderCell !== `${order.id}-${product.id}-price`" class="mt-1 w-full rounded-lg border border-blue-100 px-2 py-1.5 text-sm font-semibold text-slate-900" type="text" @input="updateOrderNumber(product, 'price', $event)" @blur="finishOrderCell(`${order.id}-${product.id}-price`)" @keydown.enter.prevent="toggleOrderCell(`${order.id}-${product.id}-price`, $event)" /></label>
                  <label class="text-xs font-medium text-slate-500">С/с / ед., ₴<input :value="formatOrderNumber(product.cost)" :readonly="editingOrderCell !== `${order.id}-${product.id}-cost`" class="mt-1 w-full rounded-lg border border-emerald-100 px-2 py-1.5 text-sm font-semibold text-slate-900" type="text" @input="updateOrderNumber(product, 'cost', $event)" @blur="finishOrderCell(`${order.id}-${product.id}-cost`)" @keydown.enter.prevent="toggleOrderCell(`${order.id}-${product.id}-cost`, $event)" /></label>
                  <div class="grid grid-cols-2 gap-2"><label class="text-xs font-medium text-slate-500">Роялти, %<input v-model.number="product.royaltyPercent" min="0" class="mt-1 w-full rounded-lg border border-orange-100 px-2 py-1.5 text-sm font-semibold text-slate-900" type="number" @change="syncProductRoyaltyAmount(order, product)" /></label><label class="text-xs font-medium text-slate-500">Роялти, ₴<input :value="getProductRoyalty(order, product)" min="0" class="mt-1 w-full rounded-lg border border-orange-100 px-2 py-1.5 text-sm font-semibold text-slate-900" type="number" @change="product.royaltyAmount = Number(($event.target as HTMLInputElement).value); syncProductRoyaltyPercent(order, product)" /></label></div>
                  <div class="sm:col-span-5 flex flex-wrap gap-x-5 gap-y-1 border-t border-slate-100 pt-3 text-sm"><span>{{ product.name }} × {{ product.quantity }} шт.</span><strong>Сумма позиции: {{ formatMoney(product.price * product.quantity) }}</strong><span class="text-slate-500">С/с позиции: {{ formatMoney(product.cost * product.quantity) }}</span></div>
                </div>
              </div>
              <div class="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm sm:grid-cols-5">
                <div><span class="text-slate-500">Итого продажа</span><strong class="mt-1 block text-base">{{ formatMoney(getOrderAmount(order)) }}</strong></div>
                <div><span class="text-slate-500">Итого с/с</span><strong class="mt-1 block text-base">{{ formatMoney(getOrderCost(order)) }}</strong></div>
                <div><span class="text-slate-500">Роялти по позициям</span><strong class="mt-1 block text-base">{{ formatMoney(getRoyalty(order)) }}</strong></div>
                <label class="text-slate-500">Доставка<input v-model.number="order.shipping" min="0" class="mt-1 block w-full rounded-lg border border-slate-200 px-2 py-1 text-sm font-semibold text-slate-900" type="number" @change="persistOrders" /></label>
                <div class="grid grid-cols-2 gap-2"><label class="text-slate-500">Эквайринг, %<input v-model.number="order.acquiringPercent" min="0" class="mt-1 block w-full rounded-lg border border-slate-200 px-2 py-1 text-sm font-semibold text-slate-900" type="number" @change="syncAcquiringAmount(order)" /></label><label class="text-slate-500">Эквайринг, ₴<input v-model.number="order.acquiring" min="0" class="mt-1 block w-full rounded-lg border border-slate-200 px-2 py-1 text-sm font-semibold text-slate-900" type="number" @change="syncAcquiringPercent(order)" /></label></div>
              </div>
            </section>
            <aside class="rounded-xl border border-slate-200 bg-white p-5 shadow-sm ring-1 ring-slate-100">
              <div class="flex items-start justify-between gap-3">
                <h3 class="text-lg font-semibold">Доставка</h3>
                <span
                  class="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700"
                  >{{ order.delivery.status }}</span
                >
              </div>
              <dl class="mt-5 space-y-4 text-sm">
                <div class="grid grid-cols-[1fr_1.35fr] gap-3">
                  <dt class="text-slate-500">Перевозчик</dt>
                  <dd class="font-semibold">{{ order.delivery.carrier }}</dd>
                </div>
                <div class="grid grid-cols-[1fr_1.35fr] gap-3">
                  <dt class="text-slate-500">ТТН</dt>
                  <dd class="font-semibold text-blue-700">{{ order.delivery.ttn }}</dd>
                </div>
                <div class="grid grid-cols-[1fr_1.35fr] gap-3">
                  <dt class="text-slate-500">Получатель</dt>
                  <dd class="font-semibold">{{ order.delivery.recipient }}</dd>
                </div>
                <div class="grid grid-cols-[1fr_1.35fr] gap-3">
                  <dt class="text-slate-500">Телефон получателя</dt>
                  <dd class="font-semibold">{{ order.delivery.recipientPhone }}</dd>
                </div>
                <div class="grid grid-cols-[1fr_1.35fr] gap-3">
                  <dt class="text-slate-500">Адрес</dt>
                  <dd class="font-semibold">
                    {{ order.delivery.city }}, {{ order.delivery.address }}
                  </dd>
                </div>
                <div class="grid grid-cols-[1fr_1.35fr] gap-3">
                  <dt class="text-slate-500">Плательщик</dt>
                  <dd class="font-semibold">{{ order.delivery.payer }}</dd>
                </div>
                <div class="grid grid-cols-[1fr_1.35fr] gap-3">
                  <dt class="text-slate-500">Оценочная стоимость</dt>
                  <dd class="font-semibold">{{ formatMoney(getOrderAmount(order)) }}</dd>
                </div>
                <div class="grid grid-cols-[1fr_1.35fr] gap-3">
                  <dt class="text-slate-500">Стоимость доставки</dt>
                  <dd class="font-semibold">{{ formatMoney(order.shipping) }}</dd>
                </div>
              </dl>
            </aside>
          </div>
        </article>
        <p v-if="visibleOrders.length === 0" class="p-8 text-center text-sm text-slate-500">
          Заказы не найдены.
        </p>
      </section>
    </div>

    <dialog
      ref="orderDialog"
      class="w-[min(42rem,calc(100%-2rem))] rounded-2xl border border-slate-200 p-0 shadow-2xl backdrop:bg-slate-950/35"
    >
      <form class="p-6" @submit.prevent="createOrder">
        <div class="flex items-center justify-between">
          <h2 class="text-xl font-semibold">Новый заказ</h2>
          <button class="text-2xl text-slate-500" type="button" @click="orderDialog?.close()">
            ×
          </button>
        </div>
        <div class="mt-5 grid gap-4 sm:grid-cols-2">
          <label class="text-sm font-medium"
            >Покупатель<input
              v-model="orderDraft.customer"
              required
              class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label
          ><label class="text-sm font-medium"
            >Телефон покупателя<input
              v-model="orderDraft.phone"
              required
              class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label
          ><label class="text-sm font-medium"
            >Площадка<select
              v-model="orderDraft.platform"
              class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
              @change="updateDraftPlatform"
            >
              <option v-for="platform in platformOptions" :key="platform" :value="platform">
                {{ platform }}
              </option>
            </select></label
          ><label class="text-sm font-medium"
            >Статус<select
              v-model="orderDraft.status"
              class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
            >
              <option
                v-for="status in statusOptions[orderDraft.platform]"
                :key="status"
                :value="status"
              >
                {{ status }}
              </option>
            </select></label
          >
        </div>
        <fieldset class="mt-5 rounded-xl border border-slate-200 p-4">
          <legend class="px-2 text-sm font-semibold">Товары в заказе</legend>
          <div
            v-for="product in orderDraft.products"
            :key="product.id"
            class="mt-2 grid gap-2 sm:grid-cols-[1fr_5rem_5rem_5rem_auto]"
          >
            <input
              v-model="product.name"
              required
              class="rounded-lg border border-slate-200 px-2 py-2"
              placeholder="Товар"
            /><input
              v-model="product.size"
              required
              class="rounded-lg border border-slate-200 px-2 py-2"
              placeholder="Размер"
            /><input
              v-model.number="product.price"
              required
              min="0"
              class="rounded-lg border border-slate-200 px-2 py-2"
              type="number"
              placeholder="Цена"
            /><input
              v-model.number="product.cost"
              required
              min="0"
              class="rounded-lg border border-slate-200 px-2 py-2"
              type="number"
              placeholder="С/с"
            /><button
              class="rounded-lg px-2 text-slate-500 hover:bg-slate-100"
              type="button"
              @click="removeProduct(product.id)"
            >
              ×
            </button>
          </div>
          <button
            class="mt-3 text-sm font-semibold text-emerald-700"
            type="button"
            @click="addProduct"
          >
            + Добавить товар
          </button>
        </fieldset>
        <div class="mt-5 grid gap-4 sm:grid-cols-2">
          <label class="text-sm font-medium"
            >Получатель<input
              v-model="orderDraft.delivery.recipient"
              required
              class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label
          ><label class="text-sm font-medium"
            >Телефон получателя<input
              v-model="orderDraft.delivery.recipientPhone"
              required
              class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label
          ><label class="text-sm font-medium"
            >Перевозчик<select
              v-model="orderDraft.delivery.carrier"
              class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
            >
              <option v-for="carrier in carrierOptions" :key="carrier" :value="carrier">
                {{ carrier }}
              </option>
            </select></label
          ><label class="text-sm font-medium"
            >ТТН<input
              v-model="orderDraft.delivery.ttn"
              class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label
          ><label class="text-sm font-medium"
            >Город<input
              v-model="orderDraft.delivery.city"
              class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label
          ><label class="text-sm font-medium"
            >Отделение / адрес<input
              v-model="orderDraft.delivery.address"
              class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label
          ><label class="text-sm font-medium"
            >Доставка, ₴<input
              v-model.number="orderDraft.shipping"
              min="0"
              class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
              type="number" /></label
          ><label class="text-sm font-medium"
            >Эквайринг, ₴<input
              v-model.number="orderDraft.acquiring"
              min="0"
              class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
              type="number"
          /></label>
        </div>
        <button
          class="mt-6 w-full rounded-xl bg-emerald-700 px-4 py-3 font-semibold text-white hover:bg-emerald-800"
          type="submit"
        >
          Создать заказ
        </button>
      </form>
    </dialog>
  </div>
</template>
