import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('./registryImportIdentifiers.ts', import.meta.url), 'utf8')
  .replace(/import type[^\n]+\n/, '')
  .replace(/export type RegistryImportIdentifier = \{[\s\S]*?\n\}\n/, '')
  .replaceAll('export function ', 'function ')
const compiled = ts.transpile(source, {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.None,
})
const context = {}
runInNewContext(compiled, context)

const novaImport = JSON.parse(
  JSON.stringify(
    context.registryImportIdentifiers(
      'РЕЄСТР ПЕРЕКАЗІВ №18108169',
      'novapay',
      ['723-4200897'],
      'ТТН',
    ),
  ),
)
assert.deepEqual(novaImport, [
  {
    bank: 'novapay',
    identifier: '18108169',
    identifierType: 'registry',
    label: 'Реестр №18108169',
  },
])
assert.equal(
  context.matchedRegistryImportIdentifier('Виплата згідно реєстру № 18108169', novaImport)?.label,
  'Реестр №18108169',
)

const meestImport = JSON.parse(
  JSON.stringify(
    context.registryImportIdentifiers('Номер реєстру: 34', 'monobank', ['723-4200897'], 'ТТН'),
  ),
)
assert.equal(meestImport[0]?.identifier, '34')
assert.equal(
  context.matchedRegistryImportIdentifier('Переказ за реєстру №34', meestImport)?.label,
  'Реестр №34',
)

const fallbackImport = JSON.parse(
  JSON.stringify(
    context.registryImportIdentifiers(
      'Виплата без номера реєстру',
      'monobank',
      ['723-4200897', 'ORDER-1234'],
      'ТТН',
    ),
  ),
)
assert.equal(
  context.matchedRegistryImportIdentifier('Переказ за посилку 723-4200897', fallbackImport)?.label,
  'ТТН 7234200897',
)
assert.equal(
  context.matchedRegistryImportIdentifier('Переказ за реєстру №999', fallbackImport),
  undefined,
)
assert.equal(
  context.matchedRegistryImportIdentifier('Сума 7234200897, дата 01.10.2026', fallbackImport),
  undefined,
)

assert.equal(
  context.receiptGrossAmount('Загалом 1450.00 грн. Комісія банку 18.85 грн.', 1431.15),
  145000,
)
assert.equal(
  context.receiptGrossAmount('На суму 345 грн за виключ. винагор. 5.87 грн.', 339.13),
  34500,
)
assert.equal(
  context.receiptGrossAmount('Загалом 1450 грн. Комісія банку 18.85 грн.', 1431.14),
  null,
)
assert.equal(context.receiptGrossAmount('Оплата 345 грн без даних про комісію.', 339.13), null)

const amountIdentifiers = JSON.parse(JSON.stringify(context.registryAmountIdentifiers(345, 339.13)))
assert.equal(amountIdentifiers.length, 2)
assert.equal(context.matchedRegistryAmountIdentifier(33913, amountIdentifiers)?.bank, 'monobank')
assert.equal(context.matchedRegistryAmountIdentifier(34500, amountIdentifiers)?.bank, 'monobank')
assert.equal(context.matchedRegistryAmountIdentifier(33914, amountIdentifiers), undefined)
assert.equal(context.registryAmountIdentifiers(345, 345).length, 1)

const imported = ['437654601', '437227449', '437562659', '436967113'].map((identifier) => ({
  bank: 'monobank', identifier, identifierType: 'operation', label: identifier,
  source: 'RozetkaPay', appliedAt: '2026-11-06T17:42:49Z',
}))
const paidOrders = new Map([
  ['437654601', { paymentAmount: 690, acquiring: 23.46 }],
  ['437227449', { paymentAmount: 145, acquiring: 2.47 }],
  ['437562659', { paymentAmount: 210, acquiring: 3.57 }],
  ['436967113', { paymentAmount: 1080, acquiring: 18.36 }],
])
const importedAmounts = context.importedRegistryAmounts(imported, paidOrders)
assert.equal(importedAmounts.has(212500), true)
assert.equal(importedAmounts.has(207714), true)
assert.equal(importedAmounts.has(207715), false)
assert.equal(context.importedRegistryAmounts(imported, new Map()).size, 0)

console.log('Registry import identifiers: OK')
