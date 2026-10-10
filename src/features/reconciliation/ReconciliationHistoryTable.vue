<script setup lang="ts">
import { computed, h } from 'vue'
import { FlexRender, tableFeatures, useTable, type ColumnDef } from '@tanstack/vue-table'

import { reconciliationReserveUsd } from './calculations'
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
    {
      id: 'date',
      header: 'Дата',
      cell: ({ row }: { row: { original: Reconciliation } }) =>
        h('div', { class: 'flex flex-col items-start gap-0.5' }, [
          h('span', props.dateTime(row.original.reconciled_at)),
          ...(row.original.kind === 'initial'
            ? [h('span', { class: 'text-xs font-semibold text-slate-500' }, 'Начальное сальдо')]
            : []),
          ...(!props.guest && row.original.id === props.latestId
            ? [
                h(
                  'button',
                  {
                    type: 'button',
                    class:
                      'w-fit rounded px-1 py-0.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500 disabled:opacity-50',
                    disabled: props.saving,
                    'aria-label': 'Удалить последнюю сверку',
                    title: 'Удалить последнюю сверку',
                    onClick: () => emit('deleteLatest'),
                  },
                  'Удалить',
                ),
              ]
            : []),
        ]),
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
      cell: ({ row }: { row: { original: Reconciliation } }) => {
        const item = row.original
        if (item.kind === 'initial') return '—'
        return h('div', { class: 'flex flex-col items-end gap-0.5 leading-tight' }, [
          h('span', `$${props.money(reconciliationReserveUsd(item.reserve_usd))}`),
          h('span', { class: 'text-slate-500' }, `+ ${props.money(Number(item.reserve_uah))} грн`),
        ])
      },
    },
    {
      id: 'adjustmentUsd',
      header: 'Сторно USD',
      cell: valueCell((item) =>
        item.kind === 'initial' ? '—' : props.money(Number(item.adjustment_usd ?? 0)),
      ),
    },
    {
      id: 'adjustmentUah',
      header: 'Сторно грн',
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
  return base
})()

const table = useTable<typeof features, Reconciliation>({
  features,
  columns,
  data,
  getRowId: (item) => item.id,
})
</script>

<template>
  <div
    v-if="history.length"
    class="mt-4 max-w-full overflow-x-auto rounded-lg border border-slate-200"
  >
    <table class="w-max min-w-full border-collapse text-sm">
      <thead class="bg-slate-100 text-slate-700">
        <tr v-for="headerGroup in table.getHeaderGroups()" :key="headerGroup.id">
          <th
            v-for="header in headerGroup.headers"
            :key="header.id"
            scope="col"
            class="whitespace-nowrap border-b border-r border-slate-300 px-2 py-2.5 text-left font-semibold last:border-r-0"
            :class="{ 'text-right': header.column.id !== 'date' }"
          >
            <FlexRender v-if="!header.isPlaceholder" :header="header" />
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in table.getRowModel().rows"
          :key="row.id"
          class="even:bg-slate-50 hover:bg-emerald-50/40"
        >
          <td
            v-for="cell in row.getAllCells()"
            :key="cell.id"
            class="whitespace-nowrap border-b border-r border-slate-200 px-2 py-2.5 align-middle tabular-nums last:border-r-0"
            :class="{ 'text-right': cell.column.id !== 'date' }"
          >
            <FlexRender :cell="cell" />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
  <p v-else class="mt-4 text-sm text-slate-500">Зафиксированных сверок пока нет.</p>
</template>
