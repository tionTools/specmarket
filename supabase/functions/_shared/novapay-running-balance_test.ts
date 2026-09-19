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

const withUnrelatedConductedDocument = assignRunningBalances(
  receipts,
  [
    ...movements,
    {
      legacyDate: '19.09.2026',
      occurredAt: '2026-09-19T15:00:00.000Z',
      amount: 999,
      providerAliases: ['id:unrelated'],
      direction: 'unknown',
    },
  ],
  balances,
)
assertEquals(
  withUnrelatedConductedDocument[1].balance,
  7373.58,
  'unrelated conducted document does not invalidate the account day',
)
assertEquals(
  withUnrelatedConductedDocument[0].balance,
  8000.43,
  'unrelated conducted document does not affect account balance',
)

const withMalformedAccountMovement = assignRunningBalances(
  receipts,
  [
    ...movements,
    {
      legacyDate: '19.09.2026',
      occurredAt: '',
      amount: 50,
      providerAliases: ['id:malformed-debit'],
      direction: 'debit',
    },
  ],
  balances,
)
assertEquals(
  withMalformedAccountMovement[1].balance,
  7373.58,
  'malformed movement does not erase valid receipt balances',
)
assertEquals(
  withMalformedAccountMovement[0].balance,
  8000.43,
  'valid movements still reconcile to authoritative close',
)

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
  new Map([['20.09.2026', { opening: 999, closing: 1250 }]]),
)
assertEquals(
  mismatchResult[1].balance,
  1100,
  'non-reconciling stated opening falls back to closing minus known day movements',
)
assertEquals(mismatchResult[0].balance, 1250, 'fallback still lands on authoritative close')

const missingOpeningResult = assignRunningBalances(
  receipts,
  movements,
  new Map([
    ['18.09.2026', { opening: 5999.49, closing: 7248.21 }],
    ['19.09.2026', { opening: null, closing: 8000.43 }],
  ]),
)
assertEquals(missingOpeningResult[1].balance, 7373.58, 'missing 19.09 opening is derived')
assertEquals(missingOpeningResult[0].balance, 8000.43, 'derived opening reaches exact close')

const updated = copyKnownBalancesByProviderAlias(
  [{ providerAliases: ['id:earlier'], balance: null }],
  result,
)
assertEquals(updated[0].balance, 7373.58, 'updated path reuses statement balance')
