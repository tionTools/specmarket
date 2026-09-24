import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

// Test the real Edge Function declarations, not a rewritten copy of their algorithm.
const source = readFileSync(
  new URL('../../../supabase/functions/sync-prom-orders/index.ts', import.meta.url),
  'utf8',
)
const home = readFileSync(new URL('../../pages/HomeView.vue', import.meta.url), 'utf8')
const parsed = ts.createSourceFile('sync-prom-orders.ts', source, ts.ScriptTarget.Latest, true)
const names = [
  'asRecord',
  'text',
  'pick',
  'readable',
  'promClientPhone',
  'phoneKey',
  'samePhone',
  'personNameKey',
  'recipientName',
  'recipientPhone',
  'deliveryRecipientName',
  'deliveryRecipientPhone',
  'resolvePromPhones',
]
const statements = parsed.statements.filter(
  (node) =>
    (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) ||
    (ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(
        (declaration) => ts.isIdentifier(declaration.name) && names.includes(declaration.name.text),
      )),
)
assert.equal(statements.length, names.length, 'actual phone helpers must all be present')
const context = { resolvePromPhones: null }
runInNewContext(
  ts.transpile(statements.map((node) => node.getText(parsed)).join('\n'), {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.None,
  }) + '\nthis.resolvePromPhones = resolvePromPhones',
  context,
)
assert.equal(typeof context.resolvePromPhones, 'function')

const buyer = '+380631234567'
const receiver = '+380501112233'
const buyerName = 'Тестовий Покупець'
const receiverName = 'Тестовий Отримувач'
const cases = [
  [
    'independent buyer and receiver',
    { recipient_name: receiverName, recipient_phone: receiver, phone: receiver },
    { phone: buyer },
    { phone: receiver, delivery: { recipient: receiverName, recipientPhone: receiver } },
    buyerName,
    buyer,
    receiver,
  ],
  [
    'client card uses receiver, explicit client_phone wins',
    { recipient_name: receiverName, recipient_phone: receiver, client_phone: buyer },
    { phone: receiver },
    { phone: receiver, delivery: { recipient: receiverName, recipientPhone: receiver } },
    buyerName,
    buyer,
    receiver,
  ],
  [
    'national and international formatting match',
    { recipient_name: receiverName, recipient_phone: '0501112233' },
    {},
    { phone: receiver, delivery: { recipient: receiverName, recipientPhone: receiver } },
    buyerName,
    '',
    '0501112233',
  ],
  [
    'known recipient is preserved when API omits phone',
    { phone: receiver, recipient_name: receiverName },
    { phone: buyer },
    { phone: receiver, delivery: { recipient: receiverName, recipientPhone: receiver } },
    buyerName,
    buyer,
    receiver,
  ],
  [
    'same person may use one phone for both roles',
    { recipient_name: buyerName, recipient_phone: buyer },
    { phone: buyer },
    { phone: buyer, delivery: { recipient: buyerName, recipientPhone: buyer } },
    buyerName,
    buyer,
    buyer,
  ],
  [
    'missing receiver must not borrow buyer phone',
    { client_phone: buyer, phone: buyer },
    { phone: buyer },
    {},
    buyerName,
    buyer,
    '',
  ],
  [
    'recipient_address.phone is read',
    {
      recipient_name: receiverName,
      client_phone: buyer,
      delivery_provider_data: { recipient_address: { phone: receiver } },
    },
    {},
    {},
    buyerName,
    buyer,
    receiver,
  ],
  [
    'changed receiver must not inherit obsolete phone',
    { recipient_name: 'Другой Получатель', client_phone: buyer },
    {},
    { delivery: { recipient: receiverName, recipientPhone: receiver } },
    buyerName,
    buyer,
    '',
  ],
  [
    'receiver phone from order is not mistaken for buyer',
    { recipient_name: receiverName, recipient_phone: receiver, phone: receiver },
    {},
    { phone: receiver, delivery: { recipient: receiverName, recipientPhone: receiver } },
    buyerName,
    '',
    receiver,
  ],
  [
    'nested delivery recipient is recognized',
    { client_phone: buyer, delivery: { recipient: { name: receiverName, phone: receiver } } },
    {},
    {},
    buyerName,
    buyer,
    receiver,
  ],
  [
    'previous correct buyer is preserved',
    { recipient_name: receiverName, recipient_phone: receiver, phone: receiver },
    {},
    { phone: buyer, delivery: { recipient: receiverName, recipientPhone: receiver } },
    buyerName,
    buyer,
    receiver,
  ],
  [
    'order.phone is buyer only if it differs from known receiver',
    { recipient_name: receiverName, recipient_phone: receiver, phone: buyer },
    {},
    {},
    buyerName,
    buyer,
    receiver,
  ],
]
for (const [label, order, client, existing, name, wantedBuyer, wantedReceiver] of cases) {
  const result = context.resolvePromPhones(
    order,
    client,
    existing,
    name,
    existing.delivery ?? {},
    order.delivery ?? {},
    order.delivery_provider_data ?? {},
  )
  assert.equal(result.buyerPhone, wantedBuyer, label + ': buyer')
  assert.equal(result.recipientPhone, wantedReceiver, label + ': receiver')
  console.log('PASS', label)
}
assert.match(
  source,
  /const \{ buyerPhone, recipientName: resolvedRecipientName, recipientPhone \} = resolvePromPhones\(/,
)
assert.match(
  source,
  /recipient:\s*resolvedRecipientName \|\| customerName\(order\),\s*recipientPhone,/,
)
assert.match(
  home,
  /order\.platform === 'Пром'\s*\? order\.phone\s*:\s*order\.phone \|\| order\.delivery\.recipientPhone/,
)
assert.match(
  home,
  /order\.platform === 'Пром'\s*\? order\.delivery\.recipientPhone\s*:\s*order\.delivery\.recipientPhone \|\| order\.phone/,
)
console.log('Prom phone regression: 12 actual-helper cases plus UI role checks PASS')
