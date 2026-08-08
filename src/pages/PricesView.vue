<script setup lang="ts">
import { computed, ref } from 'vue'

import { excelPriceCatalog, type PriceItem } from '@/features/prices/priceCatalog'

type PriceField = 'usd' | 'costUah' | 'prom' | 'epic' | 'kastaOne' | 'kastaTwo' | 'kastaThree'

const storageKey = 'specmarket-crm-prices'
const rateStorageKey = 'specmarket-crm-usd-rate'
const savedCatalog = window.localStorage.getItem(storageKey)
const items = ref<PriceItem[]>(
  savedCatalog ? (JSON.parse(savedCatalog) as PriceItem[]) : structuredClone(excelPriceCatalog),
)
const searchQuery = ref('')
const usdRate = ref(Number(window.localStorage.getItem(rateStorageKey) ?? 45.2))

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

function updateName(item: PriceItem, event: Event) {
  item.name = (event.target as HTMLInputElement).value
  save()
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
            Курс $ <input v-model.number="usdRate" class="ml-2 w-16 rounded border border-slate-200 px-1.5 py-1" inputmode="decimal" type="text" @change="saveRate" />
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
          <table class="w-full min-w-[70rem] border-collapse text-left text-sm">
            <thead
              class="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500"
            >
              <tr>
                <th class="sticky left-0 z-10 min-w-56 bg-slate-50 px-4 py-3">Название</th>
                <th class="px-4 py-3">Цена, $</th>
                <th class="px-4 py-3">Вход, ₴</th>
                <th class="px-4 py-3 text-blue-700">Prom</th>
                <th class="px-4 py-3 text-emerald-700">Эпицентр</th>
                <th class="px-4 py-3 text-orange-600">Kasta: обычная</th>
                <th class="px-4 py-3 text-orange-600">Kasta: рекомендованная</th>
                <th class="px-4 py-3 text-orange-600">Kasta: акционная</th>
                <th class="px-4 py-3"><span class="sr-only">Действия</span></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="item in visibleItems"
                :key="item.id"
                class="border-t border-slate-100 hover:bg-slate-50"
              >
                <td v-if="item.kind === 'group'" colspan="9" class="bg-emerald-50 px-4 py-3">
                  <div class="flex items-center gap-3">
                    <input :value="item.name" class="w-full max-w-md rounded-lg border border-emerald-200 bg-white px-2 py-1.5 font-bold text-emerald-950" @change="updateName(item, $event)" />
                    <button class="rounded-lg px-2 py-1 text-sm font-semibold text-rose-700 hover:bg-rose-50" type="button" @click="deleteItem(item.id)">Удалить группу</button>
                  </div>
                </td>
                <template v-else>
                <td class="sticky left-0 bg-white px-4 py-3 group-hover:bg-slate-50">
                  <input :value="item.name" class="w-full min-w-48 rounded-lg border border-slate-200 px-2 py-1.5 font-semibold" @change="updateName(item, $event)" />
                </td>
                <td class="px-4 py-2">
                  <input
                    :value="item.usd ?? ''"
                    class="w-24 rounded-lg border border-slate-200 px-2 py-1.5"
                    inputmode="decimal"
                    type="text"
                    @change="updatePrice(item, 'usd', $event)"
                  />
                </td>
                <td class="px-4 py-2">
                  <input
                    :value="getCostUah(item) ?? ''"
                    :class="item.usd === null ? 'border-slate-200 bg-white' : 'border-emerald-100 bg-emerald-50 text-emerald-900'"
                    class="w-28 rounded-lg px-2 py-1.5"
                    inputmode="decimal"
                    type="text"
                    :readonly="item.usd !== null"
                    @change="updatePrice(item, 'costUah', $event)"
                  />
                </td>
                <td class="px-4 py-2">
                  <input
                    :value="item.prom ?? ''"
                    class="w-28 rounded-lg border border-blue-100 px-2 py-1.5"
                    inputmode="decimal"
                    type="text"
                    @change="updatePrice(item, 'prom', $event)"
                  />
                </td>
                <td class="px-4 py-2">
                  <input
                    :value="item.epic ?? ''"
                    class="w-28 rounded-lg border border-emerald-100 px-2 py-1.5"
                    inputmode="decimal"
                    type="text"
                    @change="updatePrice(item, 'epic', $event)"
                  />
                </td>
                <td
                  v-for="key in ['kastaOne', 'kastaTwo', 'kastaThree'] as const"
                  :key="key"
                  class="px-4 py-2"
                >
                  <input
                    :value="item[key] ?? ''"
                    class="w-28 rounded-lg border border-orange-100 px-2 py-1.5"
                    inputmode="decimal"
                    type="text"
                    @change="updatePrice(item, key, $event)"
                  />
                </td>
                <td class="px-4 py-2"><button class="rounded-lg px-2 py-1 text-sm font-semibold text-rose-700 hover:bg-rose-50" type="button" @click="deleteItem(item.id)">Удалить</button></td>
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
