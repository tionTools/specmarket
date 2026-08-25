<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import type { User } from '@supabase/supabase-js'
import { useRoute } from 'vue-router'
import { ArrowLeft, Plus } from '@lucide/vue'

import { excelPriceCatalog, type PriceItem } from '@/features/prices/priceCatalog'
import PricesTable from '@/features/prices/PricesTable.vue'
import { supabase } from '@/lib/supabase'

type PriceField = 'usd' | 'costUah' | 'prom' | 'epic' | 'kastaOne' | 'kastaTwo' | 'kastaThree'
const sourceGroupIds = new Set([19, 31, 53, 57, 60, 64, 78, 97, 126, 148, 153, 168, 172, 178])
const epicQuestionValues: Record<number, number> = {
  13: 1400,
  32: 1170,
  34: 1250,
  35: 1300,
  36: 1300,
  38: 1110,
  40: 1750,
  45: 1485,
  46: 1200,
  61: 850,
  62: 2300,
  63: 2100,
  65: 1770,
  66: 1770,
  67: 1600,
  68: 1165,
  69: 1050,
  70: 1430,
  71: 1150,
  72: 1165,
  73: 1100,
  74: 850,
  75: 1600,
  76: 1050,
  77: 1050,
  79: 1540,
  80: 1150,
  81: 1050,
  82: 1165,
  83: 1430,
  84: 1950,
  85: 1100,
  87: 1050,
  88: 1600,
  89: 600,
  101: 50,
  102: 200,
  103: 250,
}

const storageKey = 'specmarket-crm-prices'
const route = useRoute()
const rateStorageKey = 'specmarket-crm-usd-rate'
const savedCatalog = window.localStorage.getItem(storageKey)
const items = ref<PriceItem[]>(
  (savedCatalog
    ? (JSON.parse(savedCatalog) as PriceItem[])
    : structuredClone(excelPriceCatalog)
  ).map((item) => ({
    ...item,
    epic: item.epic ?? epicQuestionValues[item.id] ?? null,
    kind: item.kind ?? (sourceGroupIds.has(item.id) ? 'group' : 'item'),
  })),
)
const usdRate = ref(Number(window.localStorage.getItem(rateStorageKey) ?? 45.2))
const draggedItemId = ref<number | null>(null)
const editingCell = ref<string | null>(null)
const editingUsdRate = ref(false)
const user = ref<User | null>(null)
const email = ref('')
const password = ref('')
const authError = ref('')
const isLoading = ref(false)
const showPassword = ref(false)
const isGuest = computed(() => user.value?.email?.toLowerCase() === 'guest@gmail.com')

async function save() {
  if (isGuest.value) return
  if (!supabase || !user.value) return
  for (const [position, item] of items.value.entries()) {
    const payload = {
      legacy_id: item.id,
      position,
      kind: item.kind ?? 'item',
      name: item.name,
      usd: item.usd,
      cost_uah: item.costUah,
      prom: item.prom,
      epic: item.epic,
      kasta_regular: item.kastaOne,
      kasta_recommended: item.kastaTwo,
      kasta_sale: item.kastaThree,
    }
    if (item.remoteId)
      await supabase.from('crm_price_items').update(payload).eq('id', item.remoteId)
    else {
      const { data } = await supabase.from('crm_price_items').insert(payload).select('id').single()
      if (data) item.remoteId = data.id
    }
  }
}

function saveRate() {
  if (isGuest.value) return
  if (supabase && user.value)
    void supabase.from('crm_settings').upsert({ key: 'usd_rate', numeric_value: usdRate.value })
}

async function signIn() {
  if (!supabase) return
  authError.value = ''
  isLoading.value = true
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.value,
    password: password.value,
  })
  isLoading.value = false
  if (error) authError.value = error.message
  else {
    user.value = data.user
    await loadCatalog()
  }
}

async function loadCatalog() {
  if (!supabase || !user.value) return
  const { data } = await supabase.from('crm_price_items').select('*').order('position')
  if (data?.length)
    items.value = data.map((row) => ({
      id: row.legacy_id ?? Date.now(),
      remoteId: row.id,
      kind: row.kind,
      name: row.name,
      usd: row.usd,
      costUah: row.cost_uah,
      prom: row.prom,
      epic: row.epic,
      kastaOne: row.kasta_regular,
      kastaTwo: row.kasta_recommended,
      kastaThree: row.kasta_sale,
    }))
  else await save()
  const { data: setting } = await supabase
    .from('crm_settings')
    .select('numeric_value')
    .eq('key', 'usd_rate')
    .maybeSingle()
  if (setting?.numeric_value) usdRate.value = Number(setting.numeric_value)
}

onMounted(async () => {
  if (!supabase) {
    authError.value = 'Нет настроек Supabase в опубликованной версии сайта.'
    return
  }
  const { data } = await supabase.auth.getSession()
  user.value = data.session?.user ?? null
  if (user.value) await loadCatalog()
})

function updateUsdRate(event: Event) {
  const value = Number((event.target as HTMLInputElement).value.replace(',', '.'))
  if (Number.isFinite(value) && value > 0) {
    usdRate.value = value
    saveRate()
  }
}

async function toggleUsdRateEdit(event: KeyboardEvent) {
  if (editingUsdRate.value) {
    updateUsdRate(event)
    editingUsdRate.value = false
    return
  }
  editingUsdRate.value = true
  await nextTick()
  ;(event.target as HTMLInputElement).select()
}

function finishUsdRateEdit(event: Event) {
  if (!editingUsdRate.value) return
  updateUsdRate(event)
  editingUsdRate.value = false
}

function formatPrice(value: number | null) {
  if (value === null) return ''
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace('.', ',')
}

function addItem() {
  if (isGuest.value) return
  items.value.unshift({
    id: Date.now(),
    name: 'Новая позиция',
    usd: null,
    costUah: null,
    prom: null,
    epic: null,
    kastaOne: null,
    kastaTwo: null,
    kastaThree: null,
  })
  save()
}

function addGroup() {
  if (isGuest.value) return
  items.value.unshift({
    id: Date.now(),
    kind: 'group',
    name: 'Новая группа товаров',
    usd: null,
    costUah: null,
    prom: null,
    epic: null,
    kastaOne: null,
    kastaTwo: null,
    kastaThree: null,
  })
  save()
}

function deleteItem(itemId: number) {
  if (isGuest.value) return
  const removed = items.value.find((item) => item.id === itemId)
  items.value = items.value.filter((item) => item.id !== itemId)
  if (removed?.remoteId && supabase)
    void supabase.from('crm_price_items').delete().eq('id', removed.remoteId)
  save()
}

function confirmDelete(item: PriceItem) {
  if (isGuest.value) return
  const label = item.kind === 'group' ? 'группу' : 'позицию'
  if (window.confirm(`Удалить ${label} «${item.name}»?`)) deleteItem(item.id)
}

function startDragging(itemId: number) {
  draggedItemId.value = itemId
}

function moveItem(targetId: number) {
  if (isGuest.value) return
  const sourceId = draggedItemId.value
  if (sourceId === null || sourceId === targetId) return
  const sourceIndex = items.value.findIndex((item) => item.id === sourceId)
  const targetIndex = items.value.findIndex((item) => item.id === targetId)
  if (sourceIndex < 0 || targetIndex < 0) return
  const [source] = items.value.splice(sourceIndex, 1)
  if (!source) return
  items.value.splice(sourceIndex < targetIndex ? targetIndex - 1 : targetIndex, 0, source)
  draggedItemId.value = null
  save()
}

function updateName(item: PriceItem, event: Event) {
  if (isGuest.value) return
  item.name = (event.target as HTMLInputElement).value
  save()
}

function getCellKey(item: PriceItem, field: string) {
  return `${item.id}-${field}`
}

async function toggleNameEdit(item: PriceItem, event: KeyboardEvent) {
  if (isGuest.value) return
  const key = getCellKey(item, 'name')
  if (editingCell.value === key) {
    updateName(item, event)
    editingCell.value = null
    return
  }
  editingCell.value = key
  await nextTick()
  ;(event.target as HTMLInputElement).select()
}

async function togglePriceEdit(item: PriceItem, field: PriceField, event: KeyboardEvent) {
  if (isGuest.value) return
  if (field === 'costUah' && item.usd !== null) return
  const key = getCellKey(item, field)
  if (editingCell.value === key) {
    updatePrice(item, field, event)
    editingCell.value = null
    return
  }
  editingCell.value = key
  await nextTick()
  ;(event.target as HTMLInputElement).select()
}

function finishEdit(item: PriceItem, field: 'name' | PriceField, event: Event) {
  if (editingCell.value !== getCellKey(item, field)) return
  if (field === 'name') updateName(item, event)
  else updatePrice(item, field, event)
  editingCell.value = null
}

function updatePrice(item: PriceItem, key: PriceField, event: Event) {
  if (isGuest.value) return
  const input = event.target as HTMLInputElement
  const value = input.value === '' ? null : Number(input.value.replace(',', '.'))
  item[key] = Number.isFinite(value) ? value : null
  save()
}
</script>

<template>
  <div class="min-h-screen bg-slate-50 text-slate-900">
    <RouterLink
      class="fixed left-0 top-1/2 z-50 flex -translate-y-1/2 flex-col items-center rounded-r-xl border border-l-0 border-blue-200 bg-white px-2 py-3 text-xs font-bold leading-4 text-blue-700 shadow-lg transition hover:bg-blue-50"
      :to="{
        path: '/',
        query: {
          ...(route.query.returnOrder ? { returnOrder: route.query.returnOrder } : {}),
          ...(route.query.returnSearch ? { returnSearch: route.query.returnSearch } : {}),
          ...(route.query.returnRegistry ? { returnRegistry: route.query.returnRegistry } : {}),
        },
      }"
      title="Вернуться к заказам"
      ><span>К</span><span class="h-2" aria-hidden="true"></span><span>З</span><span>А</span
      ><span>К</span><span>А</span><span>З</span><span>А</span><span>М</span></RouterLink
    >
    <div class="mx-auto max-w-[96rem] px-4 py-8 sm:px-6 lg:px-8">
      <header class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <RouterLink
            class="text-sm font-semibold text-emerald-700 hover:text-emerald-800"
            :to="{
              path: '/',
              query: {
                ...(route.query.returnOrder ? { returnOrder: route.query.returnOrder } : {}),
                ...(route.query.returnSearch ? { returnSearch: route.query.returnSearch } : {}),
                ...(route.query.returnRegistry
                  ? { returnRegistry: route.query.returnRegistry }
                  : {}),
              },
            }"
          >
            <ArrowLeft class="mr-1 inline size-4" aria-hidden="true" /> К заказам
          </RouterLink>
          <p class="mt-5 text-xs font-bold tracking-[0.2em] text-emerald-700">SPECMARKET CRM</p>
          <h1 class="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            Цены и себестоимость
          </h1>
          <p class="mt-2 text-sm text-slate-500">
            Перенесено из вкладки «Входящие цены». Изменения сохраняются только в этом браузере.
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <RouterLink
            class="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 shadow-sm hover:bg-emerald-100"
            to="/epicentr-royalty"
          >
            Роялти Эпицентр
          </RouterLink>
          <label
            v-if="!isGuest"
            class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm"
          >
            Курс $
            <input
              :value="formatPrice(usdRate)"
              :readonly="!editingUsdRate"
              class="catalog-cell ml-2 w-16 rounded border border-slate-200 px-1.5 py-1"
              inputmode="decimal"
              type="text"
              @blur="finishUsdRateEdit"
              @keydown.enter.prevent="toggleUsdRateEdit"
            />
          </label>
          <button
            v-if="!isGuest"
            class="rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800"
            type="button"
            @click="addItem"
          >
            <Plus class="mr-1 inline size-4" aria-hidden="true" /> Добавить позицию
          </button>
          <button
            v-if="!isGuest"
            class="rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm font-semibold text-emerald-800 shadow-sm hover:bg-emerald-50"
            type="button"
            @click="addGroup"
          >
            <Plus class="mr-1 inline size-4" aria-hidden="true" /> Добавить группу
          </button>
          <div class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
            Позиций: <strong>{{ items.length }}</strong>
          </div>
        </div>
      </header>

      <section
        v-if="!user"
        class="mt-7 max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <h2 class="text-xl font-semibold">Вход в CRM</h2>
        <p class="mt-2 text-sm text-slate-500">
          Войди под общим аккаунтом, чтобы видеть общие цены на всех устройствах.
        </p>
        <form class="mt-5 space-y-3" @submit.prevent="signIn">
          <input
            v-model="email"
            required
            class="w-full rounded-lg border border-slate-200 px-3 py-2"
            placeholder="Email"
            type="email"
          />
          <div class="relative">
            <input
              v-model="password"
              required
              class="w-full rounded-lg border border-slate-200 px-3 py-2 pr-20"
              placeholder="Пароль"
              :type="showPassword ? 'text' : 'password'"
            /><button
              class="absolute inset-y-0 right-0 px-3 text-sm text-slate-500 hover:text-emerald-700"
              type="button"
              @click="showPassword = !showPassword"
            >
              {{ showPassword ? 'Скрыть' : 'Показать' }}
            </button>
          </div>
          <p v-if="authError" class="text-sm text-rose-700">{{ authError }}</p>
          <button
            class="w-full rounded-xl bg-emerald-700 px-4 py-3 font-semibold text-white"
            :disabled="isLoading"
            type="submit"
          >
            {{ isLoading ? 'Входим…' : 'Войти' }}
          </button>
        </form>
      </section>

      <p
        v-if="user && isGuest"
        class="mt-5 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-medium text-sky-900"
      >
        Гостевой режим: доступен только просмотр цен и себестоимости.
      </p>
      <section v-if="user" class="mt-7 rounded-2xl border border-slate-200 bg-white shadow-sm">
        <PricesTable
          :items="items"
          :usd-rate="usdRate"
          :editing-cell="editingCell"
          :guest="isGuest"
          @start-dragging="startDragging"
          @move-item="moveItem"
          @confirm-delete="confirmDelete"
          @toggle-name-edit="toggleNameEdit"
          @toggle-price-edit="togglePriceEdit"
          @finish-edit="finishEdit"
        />
      </section>
      <p class="mt-3 text-xs text-slate-500">
        Если заполнена цена в $, «Вход, ₴» = цена в $ × курс. Без долларовой цены «Вход, ₴»
        заполняется вручную.
      </p>
    </div>
  </div>
</template>

<style scoped>
.catalog-cell:not([readonly]),
.catalog-table input:not([readonly]) {
  background-color: #fffbeb;
  box-shadow: 0 0 0 2px #fbbf24;
}
</style>
