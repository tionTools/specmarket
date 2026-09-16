import { assertEquals } from 'jsr:@std/assert@1'
import { newOrderPushPayload } from './firebase-messaging.ts'

Deno.test('newOrderPushPayload keeps the order id used by Android deep-linking', () => {
  assertEquals(
    newOrderPushPayload({
      id: '11111111-2222-3333-4444-555555555555',
      platform: 'Пром',
      order_label: 'A-42',
      order_number: 42,
      customer: 'Іван',
    }, 123.4),
    {
      type: 'new_order',
      order_id: '11111111-2222-3333-4444-555555555555',
      platform: 'Пром',
      total: '123.40 грн',
      customer: 'Іван',
      order_number: 'A-42',
    },
  )
})
