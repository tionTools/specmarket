import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type RecordValue = Record<string, unknown>

const asRecord = (value: unknown): RecordValue =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {}
const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : ''
const number = (value: unknown) => Number(value ?? 0) || 0

function dateParts(value: unknown) {
  const source = text(value)
  const match = source.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/)
  if (match) return { date: `${match[3]}.${match[2]}.${match[1]}`, time: `${match[4]}:${match[5]}` }
  const parsed = new Date(source)
  if (!Number.isNaN(parsed.getTime())) {
    const parts = new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(parsed)
    const get = (kind: string) => parts.find((part) => part.type === kind)?.value ?? ''
    return { date: `${get('day')}.${get('month')}.${get('year')}`, time: `${get('hour')}:${get('minute')}` }
  }
  return { date: '', time: '' }
}

function customerName(order: RecordValue) {
  return [text(order.client_last_name), text(order.client_first_name), text(order.client_second_name)]
    .filter(Boolean).join(' ') || text(order.name) || 'Покупатель Prom'
}

function sourceItems(order: RecordValue) {
  const items = order.products ?? order.items
  return Array.isArray(items) ? items.map(asRecord) : []
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const promToken = Deno.env.get('PROM_API_TOKEN')
  const authorization = request.headers.get('Authorization')
  if (!url || !anonKey || !serviceKey || !promToken || !authorization) {
    return Response.json({ ok: false, message: 'Не хватает настроек Prom.' }, { status: 500, headers: corsHeaders })
  }

  const auth = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } })
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return Response.json({ ok: false, message: 'Нужен вход в CRM.' }, { status: 401, headers: corsHeaders })
  if (user.email?.toLowerCase() === 'guest@gmail.com') return Response.json({ ok: false, message: 'Гостевой аккаунт не может запускать синхронизацию.' }, { status: 403, headers: corsHeaders })

  const response = await fetch('https://my.prom.ua/api/v1/orders/list?limit=100', {
    headers: { Authorization: `Bearer ${promToken}`, Accept: 'application/json' },
  })
  if (!response.ok) return Response.json({ ok: false, message: 'Prom не отдал заказы.', status: response.status }, { status: 502, headers: corsHeaders })

  const payload = asRecord(await response.json())
  const orders = Array.isArray(payload.orders) ? payload.orders.map(asRecord) : []
  const admin = createClient(url, serviceKey)
  let created = 0
  let updated = 0

  for (const order of orders) {
    const promId = text(order.id)
    if (!promId) continue
    const externalId = `prom:${promId}`
    const { data: existing } = await admin.from('crm_orders')
      .select('id, shipping, acquiring, acquiring_percent, delivery')
      .eq('external_id', externalId).maybeSingle()
    const previousDelivery = asRecord(existing?.delivery)
    const rawDelivery = asRecord(order.delivery)
    const deliveryText = text(order.delivery_address) || text(rawDelivery.address)
    const deliveryCost = order.delivery_cost ?? rawDelivery.cost
    const hasApiShipping = deliveryCost !== undefined && deliveryCost !== null && deliveryCost !== ''
    const { date, time } = dateParts(order.date_created ?? order.created_at)
    const data = {
      external_id: externalId,
      order_number: number(order.id), order_date: date, order_time: time,
      customer: customerName(order), phone: text(order.phone) || text(order.client_phone),
      customer_email: text(order.email) || text(order.client_email) || null,
      customer_comment: text(order.client_notes) || text(order.comment) || null,
      platform: 'Пром', status: text(order.status) || 'Новий',
      shipping: hasApiShipping ? number(deliveryCost) : number(existing?.shipping),
      acquiring: number(existing?.acquiring), acquiring_percent: existing?.acquiring_percent ?? null,
      delivery: {
        carrier: text(order.delivery_option) || text(order.delivery_service) || text(rawDelivery.service) || 'Prom',
        ttn: text(order.delivery_declaration_number) || text(order.delivery_declaration_id) || text(rawDelivery.declaration_number),
        recipient: customerName(order), recipientPhone: text(order.phone) || text(order.client_phone),
        city: text(order.delivery_city) || text(rawDelivery.city), address: deliveryText,
        status: text(order.status) || 'Новий', payer: text(order.delivery_payer) || 'Не указано',
        paymentAmount: typeof previousDelivery.paymentAmount === 'number' ? previousDelivery.paymentAmount : undefined,
        paymentMethod: text(order.payment_option) || text(order.payment_method),
      },
    }
    let orderId = existing?.id
    if (orderId) { await admin.from('crm_orders').update(data).eq('id', orderId); updated += 1 }
    else { const { data: inserted } = await admin.from('crm_orders').insert(data).select('id').single(); orderId = inserted?.id; created += 1 }
    if (!orderId) continue

    const { data: currentItems } = await admin.from('crm_order_items')
      .select('position, product_name, cost, royalty_percent, royalty_amount').eq('order_id', orderId)
    const byName = new Map((currentItems ?? []).map((item) => [item.product_name, item]))
    await admin.from('crm_order_items').delete().eq('order_id', orderId)
    const items = sourceItems(order)
    if (items.length) await admin.from('crm_order_items').insert(items.map((item, position) => {
      const name = text(item.name) || text(item.product_name) || 'Товар Prom'
      const previous = byName.get(name)
      return { order_id: orderId, position, product_name: name, size: text(item.variation) || text(item.size), quantity: number(item.quantity) || 1, price: number(item.price), cost: number(previous?.cost), royalty_percent: previous?.royalty_percent ?? null, royalty_amount: previous?.royalty_amount ?? null }
    }))
  }
  return Response.json({ ok: true, received: orders.length, created, updated }, { headers: corsHeaders })
})
