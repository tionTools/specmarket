import {
  canonicalOrderLabelTtn,
  orderLabelCarrier,
  orderLabelMailText,
  orderLabelTtns,
} from './order-label.ts'

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

const rozetkaText = `
Замовлення Prom.ua 426327729
6742
М. ХАРКІВ М. КИЇВ
PRM-251996742
1/1
`
assert(orderLabelCarrier('RozetkaDelivery') === 'rozetka', 'Rozetka carrier must be supported')
assert(
  JSON.stringify(orderLabelTtns('rozetka', rozetkaText)) === JSON.stringify(['PRM-251996742']),
  'Rozetka label must extract the standalone PRM TTN',
)
assert(
  canonicalOrderLabelTtn('rozetka', 'prm251996742') === 'PRM-251996742',
  'Rozetka stored TTN must normalize',
)
assert(
  orderLabelMailText('rozetka', 'PRM-251996742') === 'Розетка PRM-251996742',
  'Rozetka mail text must use the required carrier name',
)

const meestText = `
1 Рівне
723-1356399001001HSU М723-1356399001001HSUИО
С1
Центр видачі замовлень ЕПІЦЕНТР.ua
723-1356399
`
assert(orderLabelCarrier('Meest') === 'meest', 'Meest carrier must be supported')
assert(
  orderLabelCarrier('parcel_box_epicentr') === 'meest',
  'Epicentr parcel box must be treated as Meest',
)
assert(
  orderLabelCarrier('cvz_epicentr') === 'meest',
  'Epicentr collection point must be treated as Meest',
)
assert(
  JSON.stringify(orderLabelTtns('meest', meestText)) === JSON.stringify(['723-1356399']),
  'Meest label must ignore the longer technical barcode',
)
assert(
  canonicalOrderLabelTtn('meest', '7231356399') === '723-1356399',
  'Meest stored TTN without hyphen must normalize',
)
assert(
  orderLabelMailText('meest', '723-1356399') === 'Мист 723-1356399',
  'Meest mail text must use the required carrier name',
)
assert(orderLabelCarrier('Новая почта') === null, 'Unsupported carriers must be rejected')
