<script setup lang="ts">
import { computed, ref } from 'vue'

import { excelPriceCatalog, type PriceItem } from '@/features/prices/priceCatalog'

const storageKey = 'specmarket-crm-prices'
const savedCatalog = window.localStorage.getItem(storageKey)
const items = ref<PriceItem[]>(
  savedCatalog ? (JSON.parse(savedCatalog) as PriceItem[]) : structuredClone(excelPriceCatalog),
)
const searchQuery = ref('')

const visibleItems = computed(() => {
  const search = searchQuery.value.trim().toLowerCase()
  return items.value.filter((item) => !search || item.name.toLowerCase().includes(search))
})

function save() {
  window.localStorage.setItem(storageKey, JSON.stringify(items.value))
}

function updatePrice(item: PriceItem, key: Exclude<keyof PriceItem, 'id' | 'name'>, event: Event) {
  const input = event.target as HTMLInputElement
  const value = input.value === '' ? null : Number(input.value)
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
        <div class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
          Позиций: <strong>{{ items.length }}</strong>
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
                <th class="px-4 py-3 text-orange-600">Kasta 1</th>
                <th class="px-4 py-3 text-orange-600">Kasta 2</th>
                <th class="px-4 py-3 text-orange-600">Kasta 3</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="item in visibleItems"
                :key="item.id"
                class="border-t border-slate-100 hover:bg-slate-50"
              >
                <td class="sticky left-0 bg-white px-4 py-3 font-semibold group-hover:bg-slate-50">
                  {{ item.name }}
                </td>
                <td class="px-4 py-2">
                  <input
                    :value="item.usd ?? ''"
                    class="w-24 rounded-lg border border-slate-200 px-2 py-1.5"
                    inputmode="decimal"
                    type="number"
                    @change="updatePrice(item, 'usd', $event)"
                  />
                </td>
                <td class="px-4 py-2">
                  <input
                    :value="item.costUah ?? ''"
                    class="w-28 rounded-lg border border-slate-200 px-2 py-1.5"
                    inputmode="decimal"
                    type="number"
                    @change="updatePrice(item, 'costUah', $event)"
                  />
                </td>
                <td class="px-4 py-2">
                  <input
                    :value="item.prom ?? ''"
                    class="w-28 rounded-lg border border-blue-100 px-2 py-1.5"
                    inputmode="decimal"
                    type="number"
                    @change="updatePrice(item, 'prom', $event)"
                  />
                </td>
                <td class="px-4 py-2">
                  <input
                    :value="item.epic ?? ''"
                    class="w-28 rounded-lg border border-emerald-100 px-2 py-1.5"
                    inputmode="decimal"
                    type="number"
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
                    type="number"
                    @change="updatePrice(item, key, $event)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="visibleItems.length === 0" class="p-8 text-center text-sm text-slate-500">
          Товары не найдены.
        </p>
      </section>
      <p class="mt-3 text-xs text-slate-500">
        Пустые значения отображаются как пустые поля; введённое значение сохранится автоматически.
      </p>
    </div>
  </div>
</template>
