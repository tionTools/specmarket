import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const source = readFileSync(new URL('../../pages/HomeView.vue', import.meta.url), 'utf8')
const start = source.indexOf('async function copyOrderForSpreadsheet(')
const handler = source
  .slice(start, source.indexOf('\nfunction oneCClipboardText', start))
  .replace('order: Order', 'order')

test('Excel copies the current payment into its column without shifting other cells', async () => {
  for (const [paymentAmount, expected] of [
    [690, '690'],
    [123.45, '123,45'],
    [0, ''],
    [undefined, ''],
  ]) {
    let text
    let marked = false
    const context = {
      isClipboardSupported: { value: true },
      copied: { value: true },
      getRemainingQuantity: () => 1,
      spreadsheetProductLabel: () => 'Boots × 1',
      spreadsheetPlatformLabel: () => 'Эпик',
      spreadsheetOrderComment: () => 'order comment',
      getNetOrderCost: () => 429,
      getNetOrderAmount: () => 690,
      getNetRoyalty: () => 103.5,
      formatSpreadsheetNumber: (n) =>
        new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2, useGrouping: false }).format(n),
      copy: async (value) => {
        text = value
      },
      isSpreadsheetOrderCopied: () => marked,
      setSpreadsheetOrderCopied: async () => {
        marked = true
        return true
      },
      showInlineActionNotice() {},
      showSyncError: (message) => {
        throw Error(message)
      },
    }
    runInNewContext(handler, context)
    const order = { id: 'test', date: '03.11.2026', products: [{}], shipping: 38.45, paymentAmount }
    await context.copyOrderForSpreadsheet(order)
    assert.deepEqual(text.split('\t'), [
      '03.11.2026',
      'Эпик',
      'Boots × 1',
      '429',
      '690',
      expected,
      '103,5',
      '38,45',
      '',
      '',
      '',
      'order comment',
    ])
    assert.equal(marked, true)
    order.paymentAmount = 500
    await context.copyOrderForSpreadsheet(order)
    assert.equal(text.split('\t')[5], '500', 'repeat copying must use the updated payment')
  }
})
