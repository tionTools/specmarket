import {
  assignRunningBalances,
  copyKnownBalancesByProviderAlias,
} from './novapay-running-balance.ts'

function assertEquals(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}: ${actual} !== ${expected}`)
}

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
const result = assignRunningBalances(receipts, movements, 8000.43)

assertEquals(result[0].balance, 8000.43, 'latest 19.09 receipt')
assertEquals(result[1].balance, 7373.58, 'earlier 19.09 receipt')
assertEquals(result[2].balance, 7248.21, '18.09 receipt')

const noAliasReceipts = receipts.map((receipt) => ({ ...receipt, providerAliases: [] }))
const noAliasMovements = noAliasReceipts.map((receipt) => ({ ...receipt, direction: 'credit' }))
const noAliasResult = assignRunningBalances(noAliasReceipts, noAliasMovements, 8000.43)
assertEquals(noAliasResult[0].balance, 8000.43, 'fallback match without provider alias')
assertEquals(noAliasResult[1].balance, 7373.58, 'fallback earlier match without provider alias')
assertEquals(noAliasResult[2].balance, 7248.21, 'fallback previous-day match without provider alias')

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
  8000.43,
)
assertEquals(
  withUnrelatedConductedDocument[1].balance,
  7373.58,
  'unrelated conducted document does not affect running balance',
)
assertEquals(
  withUnrelatedConductedDocument[0].balance,
  8000.43,
  'unrelated conducted document does not affect latest balance',
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
const debitResult = assignRunningBalances(debitReceipts, debitMovements, 1250)
assertEquals(debitResult[1].balance, 1100, 'credit before debit')
assertEquals(debitResult[0].balance, 1250, 'credit after debit')

const withMalformedMovement = assignRunningBalances(
  receipts,
  [
    ...movements,
    {
      legacyDate: '19.09.2026',
      occurredAt: '',
      amount: 50,
      providerAliases: ['id:malformed'],
      direction: 'debit',
    },
  ],
  8000.43,
)
assertEquals(withMalformedMovement[1].balance, 7373.58, 'malformed movement is ignored')
assertEquals(withMalformedMovement[0].balance, 8000.43, 'valid latest balance remains')

const updated = copyKnownBalancesByProviderAlias(
  [{ ...noAliasReceipts[1], balance: null }],
  noAliasResult,
)
assertEquals(updated[0].balance, 7373.58, 'updated path also falls back without provider alias')
