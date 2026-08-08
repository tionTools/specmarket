<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'

import { excelPriceCatalog, type PriceItem } from '@/features/prices/priceCatalog'

type PriceField = 'usd' | 'costUah' | 'prom' | 'epic' | 'kastaOne' | 'kastaTwo' | 'kastaThree'
const sourceGroupIds = new Set([19, 31, 53, 57, 60, 64, 78, 97, 126, 148, 153, 168, 172, 178])

const storageKey = 'specmarket-crm-prices'
const rateStorageKey = 'specmarket-crm-usd-rate'
const savedCatalog = window.localStorage.getItem(storageKey)
const items = ref<PriceItem[]>(
  (savedCatalog ? (JSON.parse(savedCatalog) as PriceItem[]) : structuredClone(excelPriceCatalog)).map(
    (item) => ({ ...item, kind: item.kind ?? (sourceGroupIds.has(item.id) ? 'group' : 'item') }),
  ),
)
const searchQuery = ref('')
const usdRate = ref(Number(window.localStorage.getItem(rateStorageKey) ?? 45.2))
const draggedItemId = ref<number | null>(null)
const editingCell = ref<string | null>(null)

const visibleItems = computed(() => {
  const search = searchQuery.value.trim().toLowerCase()
  return items.value.filter(
    (item) => item.kind === 'group' || !search || item.name.toLowerCase().includes(search),
  )
})

function save() {
  window.localStorage.setItem(storageKey, JSON.stringify(items.value))
}

function saveRate() {
  window.localStorage.setItem(rateStorageKey, String(usdRate.value))
}

function updateUsdRate(event: Event) {
  const value = Number((event.target as HTMLInputElement).value.replace(',', '.'))
  if (Number.isFinite(value) && value > 0) {
    usdRate.value = value
    saveRate()
  }
}

function formatPrice(value: number | null) {
  if (value === null) return ''
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace('.', ',')
}

function getCostUah(item: PriceItem) {
  return item.usd === null ? item.costUah : item.usd * usdRate.value
}

function addItem() {
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
  items.value = items.value.filter((item) => item.id !== itemId)
  save()
}

function confirmDelete(item: PriceItem) {
  const label = item.kind === 'group' ? 'группу' : 'позицию'
  if (window.confirm(`Удалить ${label} «${item.name}»?`)) deleteItem(item.id)
}

function startDragging(itemId: number) {
  draggedItemId.value = itemId
}

function moveItem(targetId: number) {
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
  item.name = (event.target as HTMLInputElement).value
  save()
}

function getCellKey(item: PriceItem, field: string) {
  return `${item.id}-${field}`
}

async function toggleNameEdit(item: PriceItem, event: KeyboardEvent) {
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
  const input = event.target as HTMLInputElement
  const value = input.value === '' ? null : Number(input.value.replace(',', '.'))
  item[key] = Number.isFinite(value) ? value : null
  save()
}
</script>

<template>
  <div class="min-h-screen bg-slate-50 text-slate-900">
    <div class="mx-auto max-w-[96rem] px-4 py-8 sm:px-6 lg:px-8">
      <header class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <RouterLink class="text-sm font-semibold text-emerald-700 hover:text-emerald-800" to="/">
            ← К заказам
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
          <label class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm">
            Курс $ <input :value="formatPrice(usdRate)" class="ml-2 w-16 rounded border border-slate-200 px-1.5 py-1" inputmode="decimal" type="text" @change="updateUsdRate" />
          </label>
          <button class="rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800" type="button" @click="addItem">
            + Добавить позицию
          </button>
          <button class="rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm font-semibold text-emerald-800 shadow-sm hover:bg-emerald-50" type="button" @click="addGroup">
            + Добавить группу
          </button>
          <div class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
            Позиций: <strong>{{ items.length }}</strong>
          </div>
        </div>
      </header>

      <section class="mt-7 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div class="border-b border-slate-200 p-4">
          <input
            v-model="searchQuery"
            class="w-full max-w-md rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none transition focus:border-emerald-600"
            placeholder="Поиск по названию товара"
          />
        </div>
        <div class="overflow-x-auto">
          <table class="w-max border-collapse text-left text-sm">
            <thead
              class="sticky top-0 z-20 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500 shadow-sm"
            >
              <tr>
                <th class="sticky left-0 z-10 min-w-64 bg-slate-50 px-3 py-2">Название</th>
                <th class="px-2 py-3">Цена, $</th>
                <th class="px-2 py-3">Вход, ₴</th>
                <th class="px-2 py-3 text-blue-700">Prom</th>
                <th class="px-2 py-3 text-emerald-700">Эпицентр</th>
                <th class="w-24 px-2 py-3 text-center text-orange-600"><span class="block">Kasta</span><span>обычная</span></th>
                <th class="w-24 px-2 py-3 text-center text-orange-600"><span class="block">Kasta</span><span>рекоменд.</span></th>
                <th class="w-24 px-2 py-3 text-center text-orange-600"><span class="block">Kasta</span><span>акционная</span></th>
                <th class="px-4 py-3"><span class="sr-only">Действия</span></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="item in visibleItems"
                :key="item.id"
                class="border-t border-slate-100 hover:bg-slate-50"
                draggable="true"
                @dragover.prevent
                @dragstart="startDragging(item.id)"
                @drop="moveItem(item.id)"
              >
                <td v-if="item.kind === 'group'" colspan="9" class="border-y-2 border-emerald-200 bg-emerald-50 px-3 py-2">
                  <div class="flex items-center gap-3">
                    <span class="cursor-grab text-emerald-700" title="Перетащить">⠿</span>
                    <input :value="item.name" :readonly="editingCell !== getCellKey(item, 'name')" class="w-full max-w-md rounded-lg border border-emerald-200 bg-white px-2 py-1 font-bold uppercase text-emerald-950" @blur="finishEdit(item, 'name', $event)" @keydown.enter.prevent="toggleNameEdit(item, $event)" />
                    <button class="ml-auto shrink-0 rounded-lg p-2 text-rose-700 hover:bg-rose-50" title="Удалить группу" type="button" @click="confirmDelete(item)">
                      <svg aria-hidden="true" class="size-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 7h16M10 11v6m4-6v6M9 7l1-2h4l1 2m-9 0 1 14h10l1-14" /></svg><span class="sr-only">Удалить группу</span>
                    </button>
                  </div>
                </td>
                <template v-else>
                <td class="sticky left-0 bg-white px-3 py-1.5 group-hover:bg-slate-50">
                  <div class="flex w-64 items-center gap-1.5">
                    <span class="cursor-grab text-slate-400" title="Перетащить">⠿</span>
                    <input :value="item.name" :readonly="editingCell !== getCellKey(item, 'name')" class="w-full rounded-lg border border-slate-200 px-2 py-1 font-semibold" @blur="finishEdit(item, 'name', $event)" @keydown.enter.prevent="toggleNameEdit(item, $event)" />
                  </div>
                </td>
                <td class="px-2 py-1.5">
                  <input
                    :value="formatPrice(item.usd)"
                    class="w-20 rounded-lg border border-slate-200 px-2 py-1"
                    inputmode="decimal"
                    type="text"
                    :readonly="editingCell !== getCellKey(item, 'usd')"
                    @blur="finishEdit(item, 'usd', $event)"
                    @keydown.enter.prevent="togglePriceEdit(item, 'usd', $event)"
                  />
                </td>
                <td class="px-2 py-1.5">
                  <input
                    :value="formatPrice(getCostUah(item))"
                    :class="item.usd === null ? 'border-slate-200 bg-white' : 'border-emerald-100 bg-emerald-50 text-emerald-900'"
                    class="w-24 rounded-lg px-2 py-1"
                    inputmode="decimal"
                    type="text"
                    :readonly="item.usd !== null || editingCell !== getCellKey(item, 'costUah')"
                    @blur="finishEdit(item, 'costUah', $event)"
                    @keydown.enter.prevent="togglePriceEdit(item, 'costUah', $event)"
                  />
                </td>
                <td class="px-2 py-1.5">
                  <input
                    :value="formatPrice(item.prom)"
                    class="w-24 rounded-lg border border-blue-100 px-2 py-1"
                    inputmode="decimal"
                    type="text"
                    :readonly="editingCell !== getCellKey(item, 'prom')"
                    @blur="finishEdit(item, 'prom', $event)"
                    @keydown.enter.prevent="togglePriceEdit(item, 'prom', $event)"
                  />
                </td>
                <td class="px-2 py-1.5">
                  <input
                    :value="formatPrice(item.epic)"
                    class="w-24 rounded-lg border border-emerald-100 px-2 py-1"
                    inputmode="decimal"
                    type="text"
                    :readonly="editingCell !== getCellKey(item, 'epic')"
                    @blur="finishEdit(item, 'epic', $event)"
                    @keydown.enter.prevent="togglePriceEdit(item, 'epic', $event)"
                  />
                </td>
                <td
                  v-for="key in ['kastaOne', 'kastaTwo', 'kastaThree'] as const"
                  :key="key"
                  class="px-2 py-1.5"
                >
                  <input
                    :value="formatPrice(item[key])"
                    class="w-24 rounded-lg border border-orange-100 px-2 py-1"
                    inputmode="decimal"
                    type="text"
                    :readonly="editingCell !== getCellKey(item, key)"
                    @blur="finishEdit(item, key, $event)"
                    @keydown.enter.prevent="togglePriceEdit(item, key, $event)"
                  />
                </td>
                <td class="px-2 py-1.5">
                  <button class="rounded-lg p-2 text-rose-700 hover:bg-rose-50" title="Удалить позицию" type="button" @click="confirmDelete(item)">
                    <svg aria-hidden="true" class="size-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 7h16M10 11v6m4-6v6M9 7l1-2h4l1 2m-9 0 1 14h10l1-14" /></svg><span class="sr-only">Удалить позицию</span>
                  </button>
                </td>
                </template>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="visibleItems.length === 0" class="p-8 text-center text-sm text-slate-500">
          Товары не найдены.
        </p>
      </section>
      <p class="mt-3 text-xs text-slate-500">
        Если заполнена цена в $, «Вход, ₴» = цена в $ × курс. Без долларовой цены «Вход, ₴» заполняется вручную.
      </p>
    </div>
  </div>
</template>
