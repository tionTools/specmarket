<script setup lang="ts">
import { computed, h } from 'vue'
import { FlexRender, tableFeatures, useTable, type ColumnDef } from '@tanstack/vue-table'

import type { Reconciliation } from './types'

const props = defineProps<{
  history: Reconciliation[]
  guest: boolean
  saving: boolean
  latestId: string | undefined
  money: (value: number) => string
  dateTime: (value: string) => string
  reconciliationTotal: (item: Reconciliation) => number
  accountingTotalForHistory: (item: Reconciliation) => number
}>()

const emit = defineEmits<{ deleteLatest: [] }>()
const features = tableFeatures({})
const data = computed(() => props.history)

function valueCell(value: (item: Reconciliation) => string, className = 'py-2') {
  return ({ row }: { row: { original: Reconciliation } }) =>
    h('span', { class: className }, value(row.original))
}

const columns = (() => {
  const base = [
    { id: 'date', header: 'Дата', cell: valueCell((item) => props.dateTime(item.reconciled_at)) },
    {
      id: 'kind',
      header: 'Тип',
      cell: valueCell(
        (item) => (item.kind === 'initial' ? 'Начальное сальдо' : 'Сверка'),
        'py-2 font-semibold',
      ),
    },
    {
      id: 'usd',
      header: 'USD',
      cell: valueCell((item) => props.money(Number(item.crm_balance_usd_after_adjustment))),
    },
    {
      id: 'uah',
      header: 'Гривна',
      cell: valueCell((item) => props.money(Number(item.crm_balance_uah_after_adjustment))),
    },
    { id: 'rate', header: 'Курс', cell: valueCell((item) => props.money(Number(item.usd_rate))) },
    {
      id: 'total',
      header: 'Мой экв., грн',
      cell: valueCell((item) => props.money(props.reconciliationTotal(item)), 'py-2 font-semibold'),
    },
    {
      id: 'accountingUsd',
      header: 'USD 1С',
      cell: valueCell((item) =>
        item.kind === 'initial' ? '—' : props.money(Number(item.accounting_usd)),
      ),
    },
    {
      id: 'accountingUah',
      header: 'Грн 1С',
      cell: valueCell((item) =>
        item.kind === 'initial' ? '—' : props.money(Number(item.accounting_uah)),
      ),
    },
    {
      id: 'accountingTotal',
      header: 'Всего 1С',
      cell: valueCell((item) =>
        item.kind === 'initial' ? '—' : props.money(props.accountingTotalForHistory(item)),
      ),
    },
    {
      id: 'reserve',
      header: 'Бронь',
      cell: valueCell((item) =>
        item.kind === 'initial' ? '—' : props.money(Number(item.reserve_uah)),
      ),
    },
    {
      id: 'adjustment',
      header: 'Сторно',
      cell: valueCell((item) =>
        item.kind === 'initial' ? '—' : props.money(Number(item.adjustment_uah)),
      ),
    },
    {
      id: 'discrepancy',
      header: 'Расхождение',
      cell: valueCell((item) =>
        item.kind === 'initial' ? '—' : props.money(Number(item.discrepancy_uah)),
      ),
    },
  ] satisfies ColumnDef<typeof features, Reconciliation>[]
  if (props.guest) return base
  return [
    ...base,
    {
      id: 'actions',
      header: () => h('span', { class: 'sr-only' }, 'Действия'),
      cell: ({ row }: { row: { original: Reconciliation } }) =>
        row.original.id === props.latestId
          ? h(
              'button',
              {
                class: 'rounded-lg px-2 py-1 text-rose-700 hover:bg-rose-50',
                disabled: props.saving,
                onClick: () => emit('deleteLatest'),
              },
              'Удалить последнюю',
            )
          : null,
    },
  ] satisfies ColumnDef<typeof features, Reconciliation>[]
})()

const table = useTable<typeof features, Reconciliation>({
  features,
  columns,
  data,
  getRowId: (item) => item.id,
})
</script>

<template>
  <div v-if="history.length" class="mt-4 overflow-x-auto">
    <table class="w-full min-w-[72rem] text-left text-sm">
      <thead class="text-slate-500">
        <tr v-for="headerGroup in table.getHeaderGroups()" :key="headerGroup.id">
          <th v-for="header in headerGroup.headers" :key="header.id" class="pb-2">
            <FlexRender v-if="!header.isPlaceholder" :header="header" />
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in table.getRowModel().rows" :key="row.id" class="border-t border-slate-100">
          <td
            v-for="cell in row.getAllCells()"
            :key="cell.id"
            class="py-2"
            :class="{ 'text-right': cell.column.id === 'actions' }"
          >
            <FlexRender :cell="cell" />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
  <p v-else class="mt-4 text-sm text-slate-500">Зафиксированных сверок пока нет.</p>
</template>
