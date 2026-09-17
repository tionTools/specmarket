export type BankName = 'monobank' | 'novapay'

export type BankCache = {
  balance: number | null
  updatedAt: string | null
}

export type BankState = Record<BankName, BankCache>

export type BankPaymentEvent = {
  bank: BankName
  amount: number
  payer: string
  description: string
  comment: string
}
