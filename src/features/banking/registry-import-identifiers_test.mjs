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

console.log('Registry import identifiers: OK')
