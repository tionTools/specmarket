import {
  canonicalOrderLabelTtn,
  orderLabelCarrier,
  orderLabelMailText,
  orderLabelTtns,
} from './order-label.ts'

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

Deno.test('Rozetka label TTN and mail text', () => {
  const labelText = `
Замовлення Prom.ua 426327729
6742
М. ХАРКІВ М. КИЇВ
PRM-251996742
1/1
`
  assert(orderLabelCarrier('RozetkaDelivery') === 'rozetka', 'Rozetka carrier must be supported')
  assert(
    JSON.stringify(orderLabelTtns('rozetka', labelText)) === JSON.stringify(['PRM-251996742']),
    'Rozetka label must extract standalone PRM TTN',
  )
  assert(canonicalOrderLabelTtn('rozetka', 'prm251996742') === 'PRM-251996742', 'Rozetka TTN normalization')
  assert(orderLabelMailText('rozetka', 'PRM-251996742') === 'Розетка PRM-251996742', 'Rozetka mail text')
})

Deno.test('Meest label ignores technical barcode and supports Epicentr aliases', () => {
  const labelText = `
1 Рівне
723-1356399001001HSU М723-1356399001001HSUИО
С1
Центр видачі замовлень ЕПІЦЕНТР.ua
723-1356399
`
  assert(orderLabelCarrier('Meest') === 'meest', 'Meest carrier must be supported')
  assert(orderLabelCarrier('parcel_box_epicentr') === 'meest', 'Epicentr parcel box must be Meest')
  assert(orderLabelCarrier('cvz_epicentr') === 'meest', 'Epicentr CVZ must be Meest')
  assert(
    JSON.stringify(orderLabelTtns('meest', labelText)) === JSON.stringify(['723-1356399']),
    'Meest label must ignore technical barcode',
  )
  assert(canonicalOrderLabelTtn('meest', '7231356399') === '723-1356399', 'Meest TTN normalization')
  assert(orderLabelMailText('meest', '723-1356399') === 'Мист 723-1356399', 'Meest mail text')
})

Deno.test('Unsupported carriers are rejected', () => {
  assert(orderLabelCarrier('Новая почта') === null, 'Nova Poshta must be unsupported for label email')
})
