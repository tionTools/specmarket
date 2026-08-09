import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type RecordValue = Record<string, unknown>

const asRecord = (value: unknown): RecordValue =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {}
const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : ''
const number = (value: unknown) => Number(text(value).replace(/\s/g, '').replace(',', '.').replace(/[^\d.-]/g, '')) || 0
const pick = (record: RecordValue, ...keys: string[]) => keys.map((key) => record[key]).find((value) => value !== undefined && value !== null && value !== '')
const promStatusNames: Record<string, string> = {
  received: 'Принято',
  delivered: 'Виконано',
}
const firstNumber = (...values: unknown[]) => {
  for (const value of values) {
    const parsed = number(value)
    if (parsed !== 0) return parsed
  }
  return 0
}
function readable(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  const record = asRecord(value)
  return text(pick(record, 'title', 'name', 'label', 'value', 'description'))
}

function deliveryPayer(value: unknown): string {
  const payer = readable(value)
  const normalized = payer.toLowerCase()
  if (/(?:отримувач|получател|recipient|buyer|customer)/i.test(normalized)) return 'Получатель'
  if (/(?:відправник|отправител|sender|seller|merchant)/i.test(normalized)) return 'Отправитель'
  const names: Record<string, string> = {
    recipient: 'Получатель', buyer: 'Получатель', customer: 'Получатель',
    sender: 'Отправитель', seller: 'Отправитель', merchant: 'Отправитель',
  }
  return names[normalized] ?? payer
}

// Prom не во всех ответах присылает отдельное поле payer. В таком случае
// его тариф доставки «... (платна)» означает оплату получателем.
function payerFromDeliveryOption(value: unknown): string {
  const option = readable(value).toLowerCase()
  if (/(?:безкоштов|бесплат|free)/i.test(option)) return 'Отправитель'
  if (/(?:платн|paid)/i.test(option)) return 'Получатель'
  return ''
}

function findDeliveryTracking(value: unknown, depth = 0): string {
  if (depth > 5) return ''
  const record = asRecord(value)
  for (const [key, candidate] of Object.entries(record)) {
    if (/(?:ttn|tracking|declaration|waybill)/i.test(key)) {
      const found = text(candidate) || readable(candidate)
      if (found) return found
    }
    if (candidate && typeof candidate === 'object') {
      const found = findDeliveryTracking(candidate, depth + 1)
      if (found) return found
    }
  }
  return ''
}

function findDeliveryPayer(value: unknown, depth = 0): string {
  if (depth > 5) return ''
  const record = asRecord(value)
  for (const [key, candidate] of Object.entries(record)) {
    if (/(?:sender_pays|seller_pays|merchant_pays)/i.test(key) && candidate === true) return 'Отправитель'
    if (/(?:recipient_pays|buyer_pays|customer_pays)/i.test(key) && candidate === true) return 'Получатель'
    if (/(?:payer|payor|sender_pays|recipient_pays)/i.test(key)) {
      const found = deliveryPayer(candidate)
      if (found) return found
    }
    if (candidate && typeof candidate === 'object') {
      const found = findDeliveryPayer(candidate, depth + 1)
      if (found) return found
    }
  }
  return ''
}
function commissionAmount(value: unknown): number | undefined {
  const record = asRecord(value)
  for (const [key, candidate] of Object.entries(record)) {
    if (/(?:commission|prosale|royalty|catalog)/i.test(key)) {
      const amount = number(candidate)
      if (amount !== 0) return amount
      const nestedAmount = number(pick(asRecord(candidate), 'amount', 'price', 'value'))
      if (nestedAmount !== 0) return nestedAmount
    }
    if (candidate && typeof candidate === 'object') {
      const amount = commissionAmount(candidate)
      if (amount !== undefined) return amount
    }
  }
  return undefined
}

// Комиссии уровня заказа (включая «комісія за замовлення з сайту»).
// Товары и позиции сюда не заходят, чтобы не посчитать одну комиссию дважды.
function orderLevelCommission(value: unknown): number {
  const record = asRecord(value)
  return Object.entries(record).reduce((total, [key, candidate]) => {
    if (key === 'cpa_commission' || !/(?:commission|prosale|royalty|catalog)/i.test(key)) return total
    const amount = number(candidate) || number(pick(asRecord(candidate), 'amount', 'price', 'value'))
    return total + amount
  }, 0)
}

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

  const body = await request.json().catch(() => ({})) as { externalId?: unknown }
  const requestedExternalId = typeof body.externalId === 'string' ? body.externalId.replace(/^prom:/, '') : ''
  const endpoint = requestedExternalId
    ? `https://my.prom.ua/api/v1/orders/${encodeURIComponent(requestedExternalId)}`
    : 'https://my.prom.ua/api/v1/orders/list?limit=100'
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${promToken}`, Accept: 'application/json' },
  })
  if (!response.ok) return Response.json({ ok: false, message: 'Prom не отдал заказы.', status: response.status }, { status: 502, headers: corsHeaders })

  const payload = asRecord(await response.json())
  const orders = requestedExternalId
    ? [asRecord(payload.order ?? payload)]
    : Array.isArray(payload.orders) ? payload.orders.map(asRecord) : []
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
    const rawDelivery = asRecord(pick(order, 'delivery', 'delivery_data'))
    const deliveryProvider = asRecord(order.delivery_provider_data)
    const trackingNumber =
      text(pick(order, 'delivery_declaration_number', 'delivery_declaration_id', 'declaration_number', 'tracking_number')) ||
      text(pick(rawDelivery, 'declaration_number', 'declaration_id', 'tracking_number', 'ttn')) ||
      findDeliveryTracking(order) ||
      text(previousDelivery.ttn)
    const rawOrderStatus = text(order.status)
    const orderStatus = (promStatusNames[rawOrderStatus.toLowerCase()] ?? rawOrderStatus) || 'Новий'
    const apiDeliveryStatus =
      readable(pick(deliveryProvider, 'status_name', 'statusName', 'unified_status', 'unifiedStatus')) ||
      readable(pick(rawDelivery, 'status', 'shipment_status', 'delivery_status', 'status_name')) ||
      text(pick(order, 'shipment_status', 'delivery_status'))
    const deliveryStatus = apiDeliveryStatus ||
      (text(previousDelivery.status) && text(previousDelivery.status) !== orderStatus ? text(previousDelivery.status) : 'Заплановано')
    const isPromFreeDelivery = order.has_order_promo_free_delivery === true
    const payer = deliveryPayer(pick(order, 'delivery_payer', 'shipping_payer', 'payer')) ||
      deliveryPayer(pick(rawDelivery, 'payer', 'delivery_payer', 'shipping_payer', 'payment_payer')) ||
      findDeliveryPayer(order) ||
      payerFromDeliveryOption(pick(order, 'delivery_option', 'delivery_service')) ||
      // В части заказов API Prom вообще не возвращает плательщика. Обычная
      // доставка Prom оплачивается получателем; промо-доставка — продавцом.
      (isPromFreeDelivery ? 'Отправитель' : 'Получатель')
    const deliveryText = readable(pick(order, 'delivery_address', 'address')) || readable(pick(rawDelivery, 'address', 'full_address'))
    // Общая «delivery_cost» Prom может быть стоимостью для покупателя.
    // Для прибыли используем только отдельную сумму, которую платит продавец.
    const sellerDeliveryCost = pick(order, 'seller_delivery_cost', 'delivery_seller_cost', 'delivery_cost_seller') ?? pick(rawDelivery, 'seller_cost', 'sender_cost', 'seller_delivery_cost')
    const hasSellerDeliveryCost = sellerDeliveryCost !== undefined && sellerDeliveryCost !== null && sellerDeliveryCost !== ''
    const orderAmount = number(pick(order, 'price', 'full_price', 'amount'))
    const promoSellerDeliveryCost = isPromFreeDelivery ? (orderAmount >= 700 ? 30 : 10) : undefined
    const shippingSource = hasSellerDeliveryCost
      ? 'seller-api'
      : promoSellerDeliveryCost !== undefined
        ? 'prom-promo'
        : previousDelivery.shippingSource === 'manual'
          ? 'manual'
          : 'none'
    const { date, time } = dateParts(order.date_created ?? order.created_at)
    const data = {
      external_id: externalId,
      order_number: number(order.id), order_date: date, order_time: time,
      customer: customerName(order), phone: text(order.phone) || text(order.client_phone),
      customer_email: text(order.email) || text(order.client_email) || null,
      customer_comment: text(order.client_notes) || text(order.comment) || null,
      platform: 'Пром', status: orderStatus,
      shipping: hasSellerDeliveryCost
        ? number(sellerDeliveryCost)
        : promoSellerDeliveryCost ?? (previousDelivery.shippingSource === 'manual' ? number(existing?.shipping) : 0),
      acquiring: number(existing?.acquiring), acquiring_percent: existing?.acquiring_percent ?? null,
      delivery: {
        carrier: readable(pick(order, 'delivery_option', 'delivery_service')) || readable(pick(rawDelivery, 'service', 'provider', 'option')) || 'Prom',
        ttn: trackingNumber,
        recipient: customerName(order), recipientPhone: text(order.phone) || text(order.client_phone),
        city: readable(pick(order, 'delivery_city', 'city')) || readable(rawDelivery.city), address: deliveryText,
        status: deliveryStatus, payer,
        paymentAmount: typeof previousDelivery.paymentAmount === 'number' ? previousDelivery.paymentAmount : undefined,
        paymentMethod: readable(pick(order, 'payment_option', 'payment_method', 'payment_type', 'payment')),
        shippingSource,
      },
    }
    let orderId = existing?.id
    if (orderId) { await admin.from('crm_orders').update(data).eq('id', orderId); updated += 1 }
    else { const { data: inserted } = await admin.from('crm_orders').insert(data).select('id').single(); orderId = inserted?.id; created += 1 }
    if (!orderId) continue

    const { data: currentItems } = await admin.from('crm_order_items')
      .select('position, product_name, cost, cost_usd, royalty_percent, royalty_amount').eq('order_id', orderId)
    const byName = new Map((currentItems ?? []).map((item) => [item.product_name, item]))
    await admin.from('crm_order_items').delete().eq('order_id', orderId)
    const items = sourceItems(order)
    const itemPrice = (item: RecordValue) => {
      const quantity = number(pick(item, 'quantity', 'amount')) || 1
      return firstNumber(pick(item, 'price', 'price_uah', 'priceUAH', 'unit_price', 'base_price', 'cost'), number(pick(item, 'total_price', 'subtotal', 'sum')) / quantity)
    }
    const itemsAmount = items.reduce((total, item) => total + itemPrice(item) * (number(pick(item, 'quantity', 'amount')) || 1), 0)
    const orderCommission = number(asRecord(order.cpa_commission).amount)
    const websiteOrderCommission = orderLevelCommission(order)
    if (items.length) await admin.from('crm_order_items').insert(items.map((item, position) => {
      const name = text(item.name) || text(item.product_name) || 'Товар Prom'
      const previous = byName.get(name)
      const quantity = number(pick(item, 'quantity', 'amount')) || 1
      const price = itemPrice(item)
      const itemCommission = commissionAmount(item)
      const cpaCommission = itemCommission ?? (orderCommission && itemsAmount ? orderCommission * (price * quantity / itemsAmount) : previous?.royalty_amount ?? 0)
      const websiteCommission = websiteOrderCommission && itemsAmount
        ? websiteOrderCommission * (price * quantity / itemsAmount)
        : 0
      const royaltyAmount = number(cpaCommission) + websiteCommission
      const royaltyPercent = royaltyAmount === null || price * quantity === 0
        ? previous?.royalty_percent ?? null
        : (number(royaltyAmount) / (price * quantity)) * 100
      return { order_id: orderId, position, product_name: name, size: readable(pick(item, 'variation', 'size', 'option')), quantity, price, cost: number(previous?.cost), cost_usd: number(previous?.cost_usd), royalty_percent: royaltyPercent, royalty_amount: royaltyAmount }
    }))
  }
  return Response.json({ ok: true, received: orders.length, created, updated }, { headers: corsHeaders })
})
