function normalizeIban(value: string) {
  return value.replaceAll(' ', '').toUpperCase()
}

export function isIncomingNovaPayPayment(
  debitIban: string,
  creditIban: string,
  accountIban: string,
) {
  const account = normalizeIban(accountIban)
  const debit = normalizeIban(debitIban)
  const credit = normalizeIban(creditIban)
  return Boolean(account && debit && credit) && credit === account && debit !== account
}
