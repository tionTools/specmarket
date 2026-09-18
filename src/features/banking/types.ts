export type BankName = 'monobank' | 'novapay'

export type BankCache = {
  balance: number | null
  updatedAt: string | null
}

export type BankState = Record<BankName, BankCache>

export type BankReceipt = {
  id: string
  date: string
  occurredAt: string
  description: string
  amount: number
  balance: number | null
  comment: string
}

export type BankPeriod = {
  from: string | null
  to: string | null
}

export type BankSnapshot = BankCache & {
  bank: BankName
  receipts: BankReceipt[]
  period: BankPeriod
}

export type BankPaymentEvent = {
  bank: BankName
  amount: number
  payer: string
  description: string
  comment: string
}
