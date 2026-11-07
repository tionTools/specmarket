import type { BankName } from './types'

export type RegistryImportIdentifier = {
  bank: BankName
  identifier: string
  identifierType: 'registry' | 'operation'
  label: string
  appliedAt?: string
  source?: string
}

const registryNumberPattern =
  /(?:номер\s+)?ре[єе]стр(?:[ауіу]|ів|ов)?(?:\s+[\p{L}']+){0,2}\s*(?:[:№]|n(?:o)?\.?)\s*(\d{1,20})/giu

function normalizeOperationIdentifier(value: string) {
  return value.replace(/[^\p{L}\p{N}]/gu, '').toLocaleUpperCase('uk-UA')
}

const registryAmountPrefix = 'REGISTRY_AMOUNT_'

export function registryAmountIdentifiers(gross: number, net: number): RegistryImportIdentifier[] {
  return [...new Set([gross, net].map((amount) => Math.round(amount * 100)))]
    .filter((amount) => Number.isSafeInteger(amount) && amount > 0)
    .map((amount) => ({
      bank: 'monobank' as const,
      identifier: `${registryAmountPrefix}${amount}`,
      identifierType: 'operation' as const,
      label: `Сумма проведённого реестра ${(amount / 100).toFixed(2)} грн`,
    }))
}

export function matchedRegistryAmountIdentifier(
  amount: number,
  identifiers: RegistryImportIdentifier[],
) {
  return identifiers.find(
    (identifier) =>
      identifier.bank === 'monobank' &&
      identifier.identifier === `${registryAmountPrefix}${amount}`,
  )
}

export function importedRegistryAmounts(
  identifiers: RegistryImportIdentifier[],
  orders: Map<string, { paymentAmount: number; acquiring: number }>,
) {
  const groups = new Map<string, { gross: number; fee: number; complete: boolean }>()
  for (const identifier of identifiers) {
    if (
      identifier.bank !== 'monobank' ||
      identifier.identifierType !== 'operation' ||
      !identifier.appliedAt ||
      !/^\d+$/.test(identifier.identifier)
    ) continue
    const key = `${identifier.source ?? ''}:${identifier.appliedAt}`
    const group = groups.get(key) ?? { gross: 0, fee: 0, complete: true }
    const order = orders.get(identifier.identifier)
    if (order && Number.isFinite(order.paymentAmount) && Number.isFinite(order.acquiring)) {
      group.gross += Math.round(order.paymentAmount * 100)
      group.fee += Math.round(order.acquiring * 100)
    } else group.complete = false
    groups.set(key, group)
  }
  const amounts = new Set<number>()
  for (const group of groups.values()) {
    if (!group.complete) continue
    if (group.gross > 0) amounts.add(group.gross)
    if (group.gross - group.fee > 0) amounts.add(group.gross - group.fee)
  }
  return amounts
}

export function extractRegistryNumbers(text: string) {
  return [...new Set([...text.matchAll(registryNumberPattern)].map((match) => match[1] ?? ''))]
}

export function registryImportIdentifiers(
  text: string,
  bank: BankName,
  operationIdentifiers: string[],
  operationLabel: 'Заказ' | 'ТТН',
): RegistryImportIdentifier[] {
  const registryNumbers = extractRegistryNumbers(text)
  if (registryNumbers.length) {
    return registryNumbers.map((identifier) => ({
      bank,
      identifier,
      identifierType: 'registry',
      label: `Реестр №${identifier}`,
    }))
  }

  return [...new Set(operationIdentifiers.map(normalizeOperationIdentifier))]
    .filter((identifier) => identifier.length >= 4 && /\d/.test(identifier))
    .map((identifier) => ({
      bank,
      identifier,
      identifierType: 'operation',
      label: `${operationLabel} ${identifier}`,
    }))
}

export function matchedRegistryImportIdentifier(
  text: string,
  identifiers: RegistryImportIdentifier[],
) {
  const registryNumbers = new Set(extractRegistryNumbers(text))
  const registryMatch = identifiers.find(
    (identifier) =>
      identifier.identifierType === 'registry' && registryNumbers.has(identifier.identifier),
  )
  if (registryMatch || registryNumbers.size) return registryMatch

  const operationIdentifiers = new Set<string>()
  for (const match of text.matchAll(
    /(?:ттн|посилк[аиу]|замовленн[яюі]|заказ[ау]?|відправленн[яюі])\s*(?:№\s*)?([\p{L}\p{N}]+(?:[-/][\p{L}\p{N}]+)*)/giu,
  )) {
    const identifier = normalizeOperationIdentifier(match[1] ?? '')
    if (identifier.length >= 4 && /\d/.test(identifier)) operationIdentifiers.add(identifier)
  }
  for (const match of text.matchAll(/[\p{L}\p{N}]+(?:[-/][\p{L}\p{N}]+)+/gu)) {
    const identifier = normalizeOperationIdentifier(match[0])
    if (identifier.length >= 4 && /\d/.test(identifier)) operationIdentifiers.add(identifier)
  }
  return identifiers.find(
    (identifier) =>
      identifier.identifierType === 'operation' && operationIdentifiers.has(identifier.identifier),
  )
}

function cents(value: string) {
  const amount = Number(value.replace(/\s/gu, '').replace(',', '.'))
  return Number.isFinite(amount) ? Math.round(amount * 100) : null
}

export function receiptGrossAmount(comment: string, netAmount: number) {
  const gross = /(?:загалом|на\s+суму)\s+(\d[\d\s]*(?:[.,]\d{1,2})?)\s*грн/iu.exec(comment)
  const fee = /(?:комісія\s+банку|винагор\.)\s+(\d[\d\s]*(?:[.,]\d{1,2})?)\s*грн/iu.exec(comment)
  if (!gross?.[1] || !fee?.[1]) return null

  const grossCents = cents(gross[1])
  const feeCents = cents(fee[1])
  if (grossCents === null || feeCents === null || feeCents <= 0) return null
  return grossCents === Math.round(netAmount * 100) + feeCents ? grossCents : null
}
