import type { BankName } from './types'

export type RegistryImportIdentifier = {
  bank: BankName
  identifier: string
  identifierType: 'registry' | 'operation'
  label: string
}

const registryNumberPattern =
  /(?:номер\s+)?ре[єе]стр(?:[ауіу]|ів|ов)?(?:\s+[\p{L}']+){0,2}\s*(?:[:№]|n(?:o)?\.?)\s*(\d{1,20})/giu

function normalizeOperationIdentifier(value: string) {
  return value.replace(/[^\p{L}\p{N}]/gu, '').toLocaleUpperCase('uk-UA')
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
