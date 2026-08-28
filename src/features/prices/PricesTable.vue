<script setup lang="ts">
import { computed, h } from 'vue'
import { GripVertical, Plus, Search, Trash2, X } from '@lucide/vue'
import {
  FlexRender,
  columnVisibilityFeature,
  columnFilteringFeature,
  createFilteredRowModel,
  globalFilteringFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
} from '@tanstack/vue-table'

import type { PriceItem } from './priceCatalog'
import PlatformLogo from '@/components/ui/PlatformLogo.vue'

type PriceField = 'usd' | 'costUah' | 'prom' | 'epic' | 'kastaOne' | 'kastaTwo' | 'kastaThree'

const props = defineProps<{
  items: PriceItem[]
  usdRate: number
  editingCell: string | null
  guest: boolean
}>()

const emit = defineEmits<{
  startDragging: [id: number]
  moveItem: [id: number]
  insertItemAfter: [id: number]
  confirmDelete: [item: PriceItem]
  toggleNameEdit: [item: PriceItem, event: KeyboardEvent]
  togglePriceEdit: [item: PriceItem, field: PriceField, event: KeyboardEvent]
  finishEdit: [item: PriceItem, field: 'name' | PriceField, event: Event]
}>()

const features = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  columnVisibilityFeature,
})

function formatPrice(value: number | null) {
  if (value === null) return ''
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace('.', ',')
}

function getCostUah(item: PriceItem) {
  return item.usd === null ? item.costUah : item.usd * props.usdRate
}

function getCellKey(item: PriceItem, field: string) {
  return `${item.id}-${field}`
}

function priceCell(
  field: PriceField,
  className: string | ((item: PriceItem) => string),
  value: (item: PriceItem) => number | null,
) {
  return ({ row }: { row: { original: PriceItem } }) => {
    const item = row.original
    const disabled = field === 'costUah' && item.usd !== null
    return h('input', {
      value: formatPrice(value(item)),
      class: `catalog-cell-edit ${typeof className === 'function' ? className(item) : className}`,
      inputmode: 'decimal',
      type: 'text',
      readonly: disabled || props.editingCell !== getCellKey(item, field),
      onBlur: (event: Event) => emit('finishEdit', item, field, event),
      onKeydown: (event: KeyboardEvent) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          emit('togglePriceEdit', item, field, event)
        }
      },
    })
  }
}

const columns = [
  {
    accessorKey: 'name',
    header: 'Название',
    cell: ({ row }: { row: { original: PriceItem } }) => {
      const item = row.original
      return h('div', { class: 'flex w-[32rem] items-center gap-1.5' }, [
        h(GripVertical, { class: 'cursor-grab text-slate-400', 'aria-label': 'Перетащить' }),
        h('input', {
          value: item.name,
          readonly: props.editingCell !== getCellKey(item, 'name'),
          class:
            'catalog-cell-edit w-full rounded-lg border border-slate-200 px-2 py-1 font-semibold',
          onBlur: (event: Event) => emit('finishEdit', item, 'name', event),
          onKeydown: (event: KeyboardEvent) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              emit('toggleNameEdit', item, event)
            }
          },
        }),
      ])
    },
  },
  {
    accessorKey: 'usd',
    header: 'Цена, $',
    cell: priceCell(
      'usd',
      'w-[3.75rem] rounded-lg border border-slate-200 px-1.5 py-1',
      (item) => item.usd,
    ),
  },
  {
    id: 'costUah',
    header: 'Вход, ₴',
    cell: priceCell(
      'costUah',
      (item) =>
        `w-[4.5rem] rounded-lg px-1.5 py-1 ${item.usd === null ? 'border-slate-200 bg-white' : 'border-emerald-100 bg-emerald-50 text-emerald-900'}`,
      getCostUah,
    ),
  },
  {
    accessorKey: 'prom',
    header: () => h(PlatformLogo, { platform: 'Пром' }),
    cell: priceCell(
      'prom',
      'w-[4.5rem] rounded-lg border border-blue-100 px-1.5 py-1',
      (item) => item.prom,
    ),
  },
  {
    accessorKey: 'epic',
    header: () => h(PlatformLogo, { platform: 'Эпицентр' }),
    cell: priceCell(
      'epic',
      'w-[4.5rem] rounded-lg border border-emerald-100 px-1.5 py-1',
      (item) => item.epic,
    ),
  },
  {
    accessorKey: 'kastaOne',
    header: () => h('span', 'Каста обычная'),
    cell: priceCell(
      'kastaOne',
      'w-[4.5rem] rounded-lg border border-orange-100 px-1.5 py-1',
      (item) => item.kastaOne,
    ),
  },
  {
    accessorKey: 'kastaTwo',
    header: () => h('span', 'Каста Рек'),
    cell: priceCell(
      'kastaTwo',
      'w-[4.5rem] rounded-lg border border-orange-100 px-1.5 py-1',
      (item) => item.kastaTwo,
    ),
  },
  {
    accessorKey: 'kastaThree',
    header: () => h('span', 'Каста акция'),
    cell: priceCell(
      'kastaThree',
      'w-[4.5rem] rounded-lg border border-orange-100 px-1.5 py-1',
      (item) => item.kastaThree,
    ),
  },
  {
    id: 'actions',
    header: () => h('span', { class: 'sr-only' }, 'Действия'),
    cell: ({ row }: { row: { original: PriceItem } }) =>
      h(
        'button',
        {
          class: 'rounded-lg p-2 text-rose-700 hover:bg-rose-50',
          title: 'Удалить позицию',
          type: 'button',
          onClick: () => emit('confirmDelete', row.original),
        },
        [
          h(Trash2, { class: 'size-4', 'aria-hidden': 'true' }),
          h('span', { class: 'sr-only' }, 'Удалить позицию'),
        ],
      ),
  },
] satisfies ColumnDef<typeof features, PriceItem>[]

const data = computed(() => props.items)
const table = useTable({
  features,
  columns,
  data,
  getRowId: (item: PriceItem) => String(item.id),
  globalFilterFn: (row, _columnId, filterValue) => {
    const search = String(filterValue ?? '')
      .trim()
      .toLowerCase()
    return !search || row.original.name.toLowerCase().includes(search)
  },
})
const isEmpty = computed(() => table.getRowModel().rows.length === 0)

function handleSearch(event: Event) {
  table.setGlobalFilter((event.target as HTMLInputElement).value)
}
</script>

<template>
  <div class="border-b border-slate-200 p-4">
    <div class="relative w-full max-w-md">
      <Search
        class="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-slate-500"
        aria-hidden="true"
      />
      <input
        :value="table.atoms.globalFilter.get()"
        class="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-10 pr-10 text-sm outline-none transition focus:border-emerald-600"
        placeholder="Поиск по названию товара"
        @input="handleSearch"
      />
      <button
        v-if="table.atoms.globalFilter.get()"
        class="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-700"
        type="button"
        aria-label="Очистить поиск"
        @click="table.setGlobalFilter('')"
      >
        <X class="size-4" aria-hidden="true" />
      </button>
    </div>
  </div>
  <div class="overflow-visible">
    <table
      class="catalog-table w-max border-collapse text-left text-sm"
      :class="{ 'pointer-events-none select-none opacity-75': guest }"
    >
      <thead
        class="sticky top-0 z-20 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500 shadow-sm"
      >
        <tr v-for="headerGroup in table.getHeaderGroups()" :key="headerGroup.id">
          <th
            v-for="header in headerGroup.headers"
            :key="header.id"
            class="px-1 py-3"
            :class="{
              'sticky left-0 z-30 min-w-[32rem] bg-slate-50 px-3 py-2': header.column.id === 'name',
              'text-blue-700': header.column.id === 'prom',
              'text-emerald-700': header.column.id === 'epic',
              'w-[4.5rem] text-center text-orange-600': header.column.id.startsWith('kasta'),
              'w-10': header.column.id === 'actions',
            }"
          >
            <FlexRender v-if="!header.isPlaceholder" :header="header" />
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in table.getRowModel().rows"
          :key="row.id"
          class="group border-t border-slate-100 hover:bg-slate-50"
          draggable="true"
          @dragover.prevent
          @dragstart="emit('startDragging', row.original.id)"
          @drop="emit('moveItem', row.original.id)"
        >
          <td
            v-if="row.original.kind === 'group'"
            :colspan="table.getVisibleLeafColumns().length"
            class="relative border-y-2 border-emerald-200 bg-emerald-50 px-3 py-2"
          >
            <div class="flex items-center gap-3">
              <GripVertical class="cursor-grab text-emerald-700" aria-label="Перетащить" />
              <input
                :value="row.original.name"
                :readonly="editingCell !== getCellKey(row.original, 'name')"
                class="catalog-cell-edit w-full max-w-md rounded-lg border border-emerald-200 bg-white px-2 py-1 font-bold uppercase text-emerald-950"
                @blur="emit('finishEdit', row.original, 'name', $event)"
                @keydown.enter.prevent="emit('toggleNameEdit', row.original, $event)"
              />
              <button
                class="ml-auto shrink-0 rounded-lg p-2 text-rose-700 hover:bg-rose-50"
                title="Удалить группу"
                type="button"
                @click="emit('confirmDelete', row.original)"
              >
                <Trash2 class="size-4" aria-hidden="true" /><span class="sr-only"
                  >Удалить группу</span
                >
              </button>
            </div>
            <button
              v-if="!guest"
              class="absolute -bottom-2 -right-2 z-40 grid size-5 place-items-center rounded-full border border-emerald-300 bg-white text-emerald-700 opacity-0 shadow-sm transition hover:bg-emerald-50 focus:opacity-100 group-hover:opacity-100"
              title="Добавить позицию ниже"
              type="button"
              @mousedown.stop
              @click.stop="emit('insertItemAfter', row.original.id)"
            >
              <Plus class="size-3" aria-hidden="true" />
              <span class="sr-only">Добавить позицию ниже</span>
            </button>
          </td>
          <template v-else>
            <td
              v-for="cell in row.getAllCells()"
              :key="cell.id"
              class="px-2 py-1.5"
              :class="{
                'sticky left-0 bg-white px-3 group-hover:bg-slate-50': cell.column.id === 'name',
                relative: cell.column.id === 'actions',
              }"
            >
              <FlexRender :cell="cell" />
              <button
                v-if="cell.column.id === 'actions' && !guest"
                class="absolute -bottom-2 -right-2 z-40 grid size-5 place-items-center rounded-full border border-emerald-300 bg-white text-emerald-700 opacity-0 shadow-sm transition hover:bg-emerald-50 focus:opacity-100 group-hover:opacity-100"
                title="Добавить позицию ниже"
                type="button"
                @mousedown.stop
                @click.stop="emit('insertItemAfter', row.original.id)"
              >
                <Plus class="size-3" aria-hidden="true" />
                <span class="sr-only">Добавить позицию ниже</span>
              </button>
            </td>
          </template>
        </tr>
      </tbody>
    </table>
  </div>
  <p v-if="isEmpty" class="p-8 text-center text-sm text-slate-500">Товары не найдены.</p>
</template>

<style scoped>
.catalog-cell-edit[readonly]:focus {
  outline: none;
  box-shadow: 0 0 0 2px #60a5fa;
}

.catalog-cell-edit:not([readonly]) {
  outline: none;
  background-color: #fffbeb;
  box-shadow: 0 0 0 2px #fbbf24;
}
</style>
