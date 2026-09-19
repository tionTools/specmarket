import {
  assignRunningBalances,
  copyKnownBalancesByProviderAlias,
} from './novapay-running-balance.ts'

function assertEquals(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}: ${actual} !== ${expected}`)
}

const balances = new Map([
  ['18.09.2026', { opening: 5999.49, closing: 7248.21 }],
  ['19.09.2026', { opening: 7248.21, closing: 8000.43 }],
])

const receipts = [
  {
    legacyDate: '19.09.2026',
    occurredAt: '2026-09-19T16:47:04.000Z',
    amount: 626.85,
    balance: null,
    providerAliases: ['id:later'],
  },
  {
    legacyDate: '19.09.2026',
    occurredAt: '2026-09-19T10:56:25.000Z',
    amount: 125.37,
    balance: null,
    providerAliases: ['id:earlier'],
  },
  {
    legacyDate: '18.09.2026',
    occurredAt: '2026-09-18T16:55:54.000Z',
    amount: 1248.72,
    balance: null,
    providerAliases: ['id:previous-day'],
  },
]

const movements = receipts.map((receipt) => ({ ...receipt, direction: 'credit' }))

const result = assignRunningBalances(receipts, movements, balances)

assertEquals(result[0].balance, 8000.43, 'latest 19.09 receipt')
assertEquals(result[1].balance, 7373.58, 'earlier 19.09 receipt')
assertEquals(result[2].balance, 7248.21, '18.09 receipt')

const debitReceipts = [
  {
    legacyDate: '20.09.2026',
    occurredAt: '2026-09-20T12:00:00.000Z',
    amount: 200,
    balance: null,
    providerAliases: ['id:credit-2'],
  },
  {
    legacyDate: '20.09.2026',
    occurredAt: '2026-09-20T10:00:00.000Z',
    amount: 100,
    balance: null,
    providerAliases: ['id:credit-1'],
  },
]
const debitMovements = [
  { ...debitReceipts[1], direction: 'credit' },
  {
    legacyDate: '20.09.2026',
    occurredAt: '2026-09-20T11:00:00.000Z',
    amount: 50,
    providerAliases: ['id:debit'],
    direction: 'debit',
  },
  { ...debitReceipts[0], direction: 'credit' },
]
const debitResult = assignRunningBalances(
  debitReceipts,
  debitMovements,
  new Map([['20.09.2026', { opening: 1000, closing: 1250 }]]),
)

assertEquals(debitResult[1].balance, 1100, 'credit before debit')
assertEquals(debitResult[0].balance, 1250, 'credit after debit')

const mismatchResult = assignRunningBalances(
  debitReceipts,
  debitMovements,
  new Map([['20.09.2026', { opening: 1000, closing: 1249.99 }]]),
)
assertEquals(mismatchResult[0].balance, null, 'final mismatch clears calculated balances')
assertEquals(mismatchResult[1].balance, null, 'whole mismatched day stays uncalculated')

const updated = copyKnownBalancesByProviderAlias(
  [{ providerAliases: ['id:earlier'], balance: null }],
  result,
)
assertEquals(updated[0].balance, 7373.58, 'updated path reuses statement balance')
