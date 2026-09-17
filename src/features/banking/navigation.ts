let bankingReturnRequested = false

export function requestBankingReturn() {
  bankingReturnRequested = true
}

export function consumeBankingReturn() {
  if (!bankingReturnRequested) return false
  bankingReturnRequested = false
  return true
}
