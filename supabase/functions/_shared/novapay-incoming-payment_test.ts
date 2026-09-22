import { isIncomingNovaPayPayment } from './novapay-incoming-payment.ts'

const account = 'UA000000000000000000000000001'
const other = 'UA000000000000000000000000002'

function assertEquals(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) throw new Error(`${message}: ${actual} !== ${expected}`)
}

Deno.test('NovaPay cash withdrawal with the same debit and credit IBAN is not incoming', () => {
  assertEquals(isIncomingNovaPayPayment(account, account, account), false, 'cash withdrawal')
})

Deno.test('NovaPay payer on another IBAN and our credit IBAN is incoming', () => {
  assertEquals(isIncomingNovaPayPayment(other, account, account), true, 'real receipt')
  assertEquals(
    isIncomingNovaPayPayment(` ${other.toLowerCase()} `, ` ${account.toLowerCase()} `, account),
    true,
    'normalized IBAN',
  )
})

Deno.test('NovaPay outgoing, incomplete and unrelated documents are not incoming', () => {
  assertEquals(isIncomingNovaPayPayment(account, other, account), false, 'outgoing')
  assertEquals(isIncomingNovaPayPayment('', account, account), false, 'missing debit')
  assertEquals(isIncomingNovaPayPayment(other, '', account), false, 'missing credit')
  assertEquals(isIncomingNovaPayPayment(other, account, ''), false, 'missing account')
  assertEquals(isIncomingNovaPayPayment(other, other, account), false, 'unrelated')
})

Deno.test('NovaPay mixed operations create receipts only for real incoming payments', () => {
  const documents = [
    { debit: other, credit: account, amount: 208.95 },
    { debit: account, credit: account, amount: 8000 },
    { debit: account, credit: other, amount: 500 },
    { debit: other, credit: account, amount: 310 },
    { debit: '', credit: account, amount: 400 },
  ]
  const incoming = documents.filter((document) =>
    isIncomingNovaPayPayment(document.debit, document.credit, account),
  )
  assertEquals(incoming.length, 2, 'incoming document count')
  assertEquals(incoming[0].amount, 208.95, 'first real incoming payment')
  assertEquals(incoming[1].amount, 310, 'second real incoming payment')
})
