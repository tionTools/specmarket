import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('./novapayClearDiagnostic.ts', import.meta.url), 'utf8')
  .replace(/type PostgrestError = \{[\s\S]*?\n\}\n/, '')
  .replace(/\(payload as PostgrestError\)/, 'payload')
  .replaceAll('export function ', 'function ')
const context = {}
runInNewContext(ts.transpile(source, { target: ts.ScriptTarget.ES2022 }), context)

assert.equal(context.rollbackPreferenceApplied('return=representation, tx=rollback'), true)
assert.equal(context.rollbackPreferenceApplied('tx=commit'), false)
assert.equal(context.rollbackPreferenceApplied(null), false)
assert.equal(
  context.postgrestDiagnosticMessage({
    code: '21000',
    message: 'more than one row returned',
    details: 'detail',
    hint: 'hint',
  }),
  'code: 21000\nmessage: more than one row returned\ndetails: detail\nhint: hint',
)

console.log('NovaPay clear diagnostic: OK')
