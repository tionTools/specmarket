import assert from 'node:assert/strict'
import test from 'node:test'
import { isEpicentrShippingUnconfirmed } from './epicentrShipping.ts'

test('Epicentr profit remains preliminary until seller shipping is confirmed', () => {
  const order = (shippingSource) => ({ platform: 'Эпицентр', delivery: { shippingSource } })
  assert.equal(isEpicentrShippingUnconfirmed(order(undefined)), true)
  assert.equal(isEpicentrShippingUnconfirmed(order('unconfirmed')), true)
  assert.equal(isEpicentrShippingUnconfirmed(order('manual')), false)
  assert.equal(isEpicentrShippingUnconfirmed(order('seller-api')), false)
  assert.equal(isEpicentrShippingUnconfirmed({ platform: 'Пром', delivery: {} }), false)
})
