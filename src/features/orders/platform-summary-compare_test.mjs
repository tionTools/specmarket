import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const home = readFileSync(new URL('../../pages/HomeView.vue', import.meta.url), 'utf8')
const script = home.slice(
  home.indexOf('<script setup lang="ts">') + '<script setup lang="ts">'.length,
  home.indexOf('</script>'),
)
const parsed = ts.createSourceFile('HomeView.ts', script, ts.ScriptTarget.Latest, true)
const names = [
  'percentageChange',
  'formatPercentageChange',
  'percentageChangeClass',
  'parseOrderDate',
  'shiftDateByMonths',
  'formatShortDate',
  'previousOrderListRange',
  'ordersForPlatformSummary',
  'previousPlatformSummaryRangeLabel',
  'ordersForPreviousPlatformSummary',
  'platformOrderMetrics',
  'platformSummary',
]
const statements = parsed.statements.filter(
  (node) =>
    (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) ||
    (ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(
        (declaration) => ts.isIdentifier(declaration.name) && names.includes(declaration.name.text),
      )),
)
assert.equal(statements.length, names.length, 'use the real platform comparison declarations')

const state = {
  orderListRange: { value: { from: new Date(2026, 8, 1), to: new Date(2026, 8, 30) } },
  reportOrders: {
    value: [
      { date: '15.08.2026', platform: 'Пром', amount: 100, planned: 25, actual: 17, paid: true },
      { date: '16.08.2026', platform: 'Пром', amount: 200, planned: 35, actual: 55, paid: false },
      {
        date: '30.08.2026',
        platform: 'Эпицентр',
        amount: 300,
        planned: 45,
        actual: 40,
        paid: true,
      },
      {
        date: '31.08.2026',
        platform: 'Эпицентр',
        amount: 700,
        planned: 50,
        actual: 55,
        paid: true,
      },
      { date: '15.09.2026', platform: 'Пром', amount: 400, planned: 60, actual: 50, paid: true },
      { date: '01.07.2026', platform: 'Пром', amount: 999, planned: 99, actual: 99, paid: true },
    ],
  },
  platformOptions: ['Пром', 'Эпицентр'],
}
const context = {
  ...state,
  computed: (calculate) => ({
    get value() {
      return calculate()
    },
  }),
  orderBusinessPlatform: (order) => order.platform,
  getNetOrderAmount: (order) => order.amount,
  getPlannedProfit: (order) => order.planned,
  getActualProfit: (order) => order.actual,
  hasActualFinancialResult: (order) => order.paid,
}
runInNewContext(
  ts.transpile(statements.map((node) => node.getText(parsed)).join('\n'), {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.None,
  }) +
    '\nthis.fixture = { previousOrderListRange, previousPlatformSummaryRangeLabel, platformSummary, formatPercentageChange, percentageChangeClass }',
  context,
)
const fixture = context.fixture
const month = fixture.previousOrderListRange.value
assert.equal(month.from.getDate(), 1)
assert.equal(month.from.getMonth(), 7)
assert.equal(month.to.getDate(), 30, 'comparison uses the matching previous-month date')
assert.equal(fixture.previousPlatformSummaryRangeLabel.value, '01.08–30.08')

const prom = fixture.platformSummary.value.find((item) => item.platform === 'Пром')
const epicentr = fixture.platformSummary.value.find((item) => item.platform === 'Эпицентр')
assert.equal(prom.count, 1, 'existing current period stays intact')
assert.equal(prom.turnover, 400)
assert.equal(prom.previous.count, 2)
assert.equal(prom.previous.turnover, 300)
assert.equal(prom.previous.planned, 60)
assert.equal(prom.previous.actual, 17, 'only actual financial results count')
assert.equal(epicentr.previous.count, 1)
assert.equal(epicentr.previous.turnover, 300, 'Aug 30 is included and Aug 31 is excluded')

state.orderListRange.value = { from: new Date(2026, 8, 15), to: new Date(2026, 8, 25) }
const custom = fixture.previousOrderListRange.value
assert.equal(custom.from.getMonth(), 7)
assert.equal(custom.from.getDate(), 15)
assert.equal(custom.to.getDate(), 25)
assert.equal(
  fixture.platformSummary.value.find((item) => item.platform === 'Эпицентр').previous.count,
  0,
)

assert.equal(fixture.formatPercentageChange(68, 79), '-13,9%')
assert.equal(fixture.formatPercentageChange(0, 9), '-100%')
assert.equal(fixture.formatPercentageChange(0, 0), '0%')
assert.equal(fixture.formatPercentageChange(1, 0), '—', 'zero previous baseline is undefined')
assert.equal(fixture.formatPercentageChange(-20, -50), '+60%')
assert.equal(fixture.percentageChangeClass(200, 100), 'text-emerald-600')
assert.equal(fixture.percentageChangeClass(50, 100), 'text-rose-600')

const cardStart = home.indexOf('v-for="item in platformSummary"')
const cardEnd = home.indexOf('</article>', cardStart)
assert.ok(cardStart > 0 && cardEnd > cardStart)
const card = home.slice(cardStart, cardEnd)
assert.match(card, /v-if="isComparingPreviousPeriod"/)
assert.match(card, /previousPlatformSummaryRangeLabel/)
for (const field of ['count', 'turnover', 'planned', 'actual'])
  assert.ok(card.includes('item.previous.' + field), 'previous ' + field + ' is rendered')
for (const field of ['count', 'turnover', 'planned', 'actual']) {
  assert.ok(
    card.includes(`formatPercentageChange(item.${field}, item.previous.${field})`),
    'percentage change for platform ' + field,
  )
}
for (const field of ['orders', 'turnover', 'planned', 'actual']) {
  assert.ok(
    home.includes(`formatPercentageChange(summary.period.${field}, summary.previous.${field})`),
    'percentage change for total ' + field,
  )
}
assert.match(home, /v-model="isComparingPreviousPeriod"/)
console.log(
  'Platform summary compare: previous dates, independent platform metrics and shared checkbox PASS',
)
