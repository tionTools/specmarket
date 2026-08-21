import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type RecordValue = Record<string, unknown>

const asRecord = (value: unknown): RecordValue =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {}
const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : ''
const number = (value: unknown) => Number(text(value).replace(',', '.').replace(/[^\d.-]/g, '')) || 0
const pick = (record: RecordValue, ...keys: string[]) => keys.map((key) => record[key]).find((value) => value !== undefined && value !== null && value !== '')
const shipmentValue = (value: unknown) => text(value).replace(/\s/g, '').toLowerCase()
function shipmentCarrier(value: unknown) {
  const carrier = shipmentValue(value)
  if (carrier.includes('nova') || carrier.includes('нова')) return 'nova'
  if (carrier.includes('meest') || carrier.includes('міст')) return 'meest'
  if (carrier.includes('rozetka')) return 'rozetka'
  if (carrier.includes('ukr') || carrier.includes('укр')) return 'ukrposhta'
  return carrier
}
function preserveTracking(delivery: RecordValue, carrier: string, ttn: string): RecordValue {
  if (shipmentValue(delivery.ttn) !== shipmentValue(ttn) || shipmentCarrier(delivery.carrier) !== shipmentCarrier(carrier)) return {}
  return Object.fromEntries(Object.entries(delivery).filter(([key, value]) => key.startsWith('tracking') && value !== undefined))
}

function nameOf(person: RecordValue) {
  return [text(person.last_name), text(person.first_name), text(person.middle_name)].filter(Boolean).join(' ')
}

function dateParts(value: unknown) {
  const date = new Date(text(value))
  if (Number.isNaN(date.getTime())) return { date: '', time: '' }
  const parts = new Intl.DateTimeFormat('uk-UA', {
    timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date)
  const get = (kind: string) => parts.find((part) => part.type === kind)?.value ?? ''
  return { date: `${get('day')}.${get('month')}.${get('year')}`, time: `${get('hour')}:${get('minute')}` }
}

const orderStatuses: Record<string, string> = {
  Created: 'Новый', ConfirmedBySupplier: 'Принято', Packed: 'Принято', AnnouncedForDelivery: 'В дороге', SentToDelivery: 'В дороге', SentToSelfDelivery: 'В дороге', Delivered: 'Закрыт', ReceivedAtSelfDelivery: 'Закрыт', Cancelled: 'Скасовано', Refunded: 'Возврат', ReturnCreated: 'Возврат', ReturnSent: 'Возврат', ReturnDelivered: 'Возврат', ReturnArrived: 'Возврат',
}

function latestStatus(order: RecordValue) {
  const statuses = Array.isArray(order.statuses) ? order.statuses.map(asRecord) : []
  // After a cancellation Kasta may add a technical money-refund transaction.
  // It does not turn the cancelled order into a goods return.
  const cancellations = statuses.filter((status) => text(status.type) === 'Cancelled')
  if (cancellations.length) {
    return cancellations.reduce((latest, status) => {
      const latestDate = new Date(text(latest.created_at)).getTime()
      const currentDate = new Date(text(status.created_at)).getTime()
      return currentDate >= latestDate ? status : latest
    }, asRecord(cancellations[0]))
  }
  return statuses.reduce((latest, status) => {
    const latestDate = new Date(text(latest.created_at)).getTime()
    const currentDate = new Date(text(status.created_at)).getTime()
    return currentDate >= latestDate ? status : latest
  }, asRecord(statuses[0]))
}

function receivedAt(order: RecordValue): string {
  const statuses = Array.isArray(order.statuses) ? order.statuses.map(asRecord) : []
  const received = statuses
    .filter((status) => ['Delivered', 'ReceivedAtSelfDelivery'].includes(text(status.type)))
    .sort((a, b) => new Date(text(a.created_at)).getTime() - new Date(text(b.created_at)).getTime())
  return text(received[0]?.created_at)
}

function itemRows(order: RecordValue) {
  const statuses = Array.isArray(order.statuses) ? order.statuses.map(asRecord) : []
  const isCancelled = statuses.some((status) => text(status.type) === 'Cancelled')
  const isReturn = statuses.some((status) => /^(?:Return|Refund)/.test(text(status.type)))
  const returnedItems = Array.isArray(order.returned_items) ? order.returned_items : []
  const orderedItems = Array.isArray(order.ordered_items) ? order.ordered_items : Array.isArray(order.items) ? order.items : []
  const cancelledItems = Array.isArray(order.cancelled_items) ? order.cancelled_items : []
  const items = isCancelled && cancelledItems.length
    ? cancelledItems
    : isReturn && returnedItems.length
      ? returnedItems
      : orderedItems.length
        ? orderedItems
        : returnedItems.length
          ? returnedItems
          : cancelledItems
  return items.map(asRecord).filter((item) => text(pick(item, 'name', 'title', 'product_name', 'kind', 'supplier_code')))
}

function itemQuantity(item: RecordValue) {
  const quantity = pick(item, 'quantity', 'returned_quantity', 'cancelled_quantity', 'original_quantity')
  return quantity === undefined ? 1 : number(quantity)
}

function itemImage(item: RecordValue) {
  const images = Array.isArray(item.images) ? item.images.map(text).filter(Boolean) : []
  return images[0] ?? text(pick(item, 'image', 'image_url', 'picture', 'photo'))
}

function itemBonus(item: RecordValue) {
  const bonuses = Array.isArray(item.bonuses) ? item.bonuses.map(asRecord) : []
  return bonuses.reduce((total, bonus) => total + number(bonus.amount), 0)
}

function itemPrice(item: RecordValue) {
  return number(pick(item, 'new_price', 'paid_price', 'price'))
}

type CoFinanceRate = { max: number, cost: number }
type CoFinanceTariff = { effective_date: string, rates: CoFinanceRate[] }

// A tariff is active from its effective date until the next tariff begins.
// Add a new entry when Kasta changes its co-finance terms; no end date is needed.
const TARIF_SCHEDULE: CoFinanceTariff[] = [
  {
    effective_date: '2026-08-01',
    rates: [
      { max: 399, cost: 19 },
      { max: 699, cost: 25 },
      { max: 1499, cost: 39 },
      { max: Infinity, cost: 102 },
    ],
  },
  {
    effective_date: '2026-04-14',
    rates: [
      { max: 399, cost: 19 },
      { max: 699, cost: 25 },
      { max: Infinity, cost: 39 },
    ],
  },
]

function orderDateKey(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const part = (kind: string) => parts.find((item) => item.type === kind)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function calculateKastaDeliveryCost(orderDate: string, customerDeliveryFee: number, orderAmount: number, blackUsed: boolean, isCancelledOrReturned: boolean): number | undefined {
  if (isCancelledOrReturned) return 0
  if (!blackUsed) return 0
  const tariff = [...TARIF_SCHEDULE]
    .sort((a, b) => b.effective_date.localeCompare(a.effective_date))
    .find((candidate) => orderDate >= candidate.effective_date)
  if (!tariff) return undefined
  if (customerDeliveryFee > 0) return 0
  return tariff.rates.find((rate) => orderAmount <= rate.max)?.cost ?? 0
}

function isCancelledOrReturned(order: RecordValue): boolean {
  const statuses = Array.isArray(order.statuses) ? order.statuses.map(asRecord) : []
  return statuses.some((status) => {
    const type = text(status.type)
    return type === 'Cancelled' || /^(?:Return|Refund)/.test(type)
  })
}

function orderAmount(order: RecordValue, items: RecordValue[]): number {
  const apiAmount = number(pick(order, 'order_amount', 'total_amount', 'amount', 'total_price'))
  if (apiAmount > 0) return apiAmount
  return items.reduce((total, item) => total + itemPrice(item) * itemQuantity(item), 0)
}

function customerDeliveryFee(order: RecordValue, delivery: RecordValue): number {
  // Kasta documents paid_price as the amount paid by the buyer after bonuses.
  // cost is the carrier tariff and must not be treated as the buyer's payment.
  return number(pick(delivery, 'paid_price'))
    || number(pick(order, 'delivery_cost', 'shipping_fee', 'delivery_fee'))
}

function itemBarcode(item: RecordValue) {
  const barcodes = Array.isArray(item.barcode) ? item.barcode.map(text).filter(Boolean) : []
  return barcodes[0] ?? text(item.barcode)
}

function royaltyPercent(value: unknown) {
  const royalty = number(value)
  return royalty > 0 && royalty <= 1 ? royalty * 100 : royalty
}

function decodeXmlText(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

async function imagesFromFeed(feedUrl: string | undefined) {
  const images = new Map<string, string>()
  if (!feedUrl) return images
  try {
    const response = await fetch(feedUrl)
    if (!response.ok) return images
    const xml = await response.text()
    for (const offer of xml.matchAll(/<offer\b[^>]*\bid=(["'])([^"']+)\1[^>]*>([\s\S]*?)<\/offer>/gi)) {
      const body = offer[3]
      const imageUrl = decodeXmlText(body.match(/<picture\b[^>]*>([\s\S]*?)<\/picture>/i)?.[1] ?? '')
      if (imageUrl) images.set(offer[2], imageUrl)
      const vendorCode = decodeXmlText(body.match(/<vendorCode\b[^>]*>([\s\S]*?)<\/vendorCode>/i)?.[1] ?? '')
      if (imageUrl && vendorCode) images.set(vendorCode, imageUrl)
    }
  } catch {
    // The order still syncs when the catalogue feed is temporarily unavailable.
  }
  return images
}

async function fetchKastaOrders(token: string, query: URLSearchParams, path = '/api/orders/list') {
  const response = await fetch(`https://hub.kasta.ua${path}?${query}`, {
    headers: { Authorization: token, Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(String(response.status))
  return asRecord(await response.json())
}

function productRows(payload: RecordValue) {
  const rows = [payload.items, payload.products, payload.data].find(Array.isArray)
  return Array.isArray(rows) ? rows.map(asRecord) : []
}

async function kastaRoyaltyForItem(token: string, item: RecordValue, cache: Map<string, number>) {
  const barcode = itemBarcode(item)
  const supplierCode = text(item.supplier_code)
  const uniqueSkuId = text(item.unique_sku_id)
  const size = text(pick(item, 'kasta_size', 'size'))
  const cacheKey = [barcode, supplierCode, uniqueSkuId, size].join('|')
  if (cache.has(cacheKey)) return cache.get(cacheKey)
  try {
    let cursor = ''
    for (let page = 0; page < 30; page += 1) {
      const query = new URLSearchParams()
      if (barcode) query.set('barcode', barcode)
      else if (cursor) query.set('cursor', cursor)
      const payload = await fetchKastaOrders(token, query, '/api/products/list')
      const product = productRows(payload).find((candidate) =>
        (uniqueSkuId && text(candidate.unique_sku_id) === uniqueSkuId) ||
        (supplierCode && text(candidate.supplier_code) === supplierCode && (!size || text(candidate.size) === size)),
      )
      if (product) {
        const royalty = royaltyPercent(product.royalty)
        console.log(JSON.stringify({ kastaRoyaltyLookup: { barcode, supplierCode, size, page, productKeys: Object.keys(product), royalty } }))
        cache.set(cacheKey, royalty)
        return royalty || undefined
      }
      cursor = text(payload.cursor)
      if (!cursor || barcode) break
    }
    console.log(JSON.stringify({ kastaRoyaltyLookup: { barcode, supplierCode, size, found: false } }))
    return undefined
  } catch {
    return undefined
  }
}

async function latestKastaPage(token: string) {
  let earliest = Date.parse('2023-01-01T00:00:00.000Z')
  let latest = Date.now()
  let candidate: RecordValue = {}
  for (let attempt = 0; attempt < 18; attempt += 1) {
    const middle = new Date((earliest + latest) / 2).toISOString()
    const payload = await fetchKastaOrders(token, new URLSearchParams({ limit: '100', from: middle }))
    const received = Array.isArray(payload.items) ? payload.items.length : 0
    const remains = number(payload.remains)
    if (received === 100 && remains === 0) candidate = payload
    if (received < 100 || (received === 100 && remains === 0)) latest = Date.parse(middle)
    else earliest = Date.parse(middle)
  }
  return candidate
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const kastaToken = Deno.env.get('KASTA_API_TOKEN')
  const authorization = request.headers.get('Authorization')
  if (!url || !anonKey || !serviceKey || !kastaToken || !authorization) return Response.json({ ok: false, message: 'Не хватает настроек Касты.' }, { status: 500, headers: corsHeaders })

  const admin = createClient(url, serviceKey)
  const { data: cronSecret } = await admin.rpc('get_crm_sync_cron_secret')
  const isScheduledRequest = typeof cronSecret === 'string' && authorization === `Bearer ${cronSecret}`
  const auth = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } })
  const { data: { user } } = await auth.auth.getUser()
  if (!isScheduledRequest && !user) return Response.json({ ok: false, message: 'Нужен вход в CRM.' }, { status: 401, headers: corsHeaders })
  if (!isScheduledRequest && user.email?.toLowerCase() === 'guest@gmail.com') return Response.json({ ok: false, message: 'Гостевой аккаунт не может запускать синхронизацию.' }, { status: 403, headers: corsHeaders })

  const body = await request.json().catch(() => ({})) as { full?: unknown; externalId?: unknown }
  const fullSync = body.full === true
  const targetOrderId = text(body.externalId).replace(/^kasta:/, '')
  let payload: RecordValue
  try {
    // Kasta cursors continue through the entire history. Bulk CRM syncs must
    // always stay in the current 100-order window; only a direct order refresh
    // is allowed to request a specific historical order.
    payload = targetOrderId
      ? await fetchKastaOrders(kastaToken, new URLSearchParams({ limit: '100', order_id: targetOrderId }))
      : await latestKastaPage(kastaToken)
  } catch (error) {
    return Response.json({ ok: false, message: `Каста не отдала заказы (${error instanceof Error ? error.message : 'ошибка'}).` }, { status: 502, headers: corsHeaders })
  }
  const orders = Array.isArray(payload.items) ? payload.items.map(asRecord) : []
  const feedImages = await imagesFromFeed(Deno.env.get('PROM_PRODUCTS_FEED_URL'))
  const royaltyCache = new Map<string, number>()
  let created = 0
  let updated = 0
  let skipped = 0

  for (const order of orders) {
    const kastaId = text(order.id)
    if (!kastaId) continue
    const externalId = `kasta:${kastaId}`
    const { data: existing } = await admin.from('crm_orders').select('id, shipping, acquiring, acquiring_percent, delivery').eq('external_id', externalId).maybeSingle()
    if (existing && !fullSync && !targetOrderId) { skipped += 1; continue }
    const client = asRecord(order.client)
    const address = asRecord(order.shipping_address)
    const delivery = asRecord(order.delivery_properties)
    const status = latestStatus(order)
    const createdStatus = (Array.isArray(order.statuses) ? order.statuses.map(asRecord) : []).find((item) => text(item.type) === 'Created') ?? status
    const createdAt = text(createdStatus.created_at) || text(status.created_at)
    const items = itemRows(order)
    const deliveryFee = customerDeliveryFee(order, delivery)
    const receivedDate = receivedAt(order)
    const blackUsed = delivery.black_used === true
    // Show the expected co-finance as soon as the order is created. Once Kasta
    // records receipt, its date becomes the tariff date; cancelled/returned
    // orders are always cleared automatically.
    const tariffDate = orderDateKey(receivedDate || createdAt)
    const calculatedShipping = calculateKastaDeliveryCost(tariffDate, deliveryFee, orderAmount(order, items), blackUsed, isCancelledOrReturned(order))
    const deliveryStatus = text(status.type) === 'Delivered' || text(status.type) === 'ReceivedAtSelfDelivery' ? 'Получено' : text(status.type) === 'Cancelled' ? 'Скасовано' : text(status.type) === 'AnnouncedForDelivery' || text(status.type) === 'SentToDelivery' ? 'В дороге' : 'Запланировано'
    const customer = nameOf(client) || nameOf(address) || 'Покупатель Касты'
    const deliveryAddress = [text(asRecord(address.city).name), text(asRecord(address.warehouse).name)].filter(Boolean).join(', ')
    const currentDelivery = asRecord(existing?.delivery)
    const deliveryCarrier = text(delivery.type) === 'novaposhta'
      ? 'Новая почта'
      : text(delivery.type) || text(currentDelivery.carrier) || 'Каста'
    const deliveryTtn = text(delivery.declaration_number) || text(currentDelivery.ttn)
    const data = ({
	external_id: externalId,
	order_number: Number(kastaId.replace(/\D/g, '')) || 0,
	order_label: kastaId,
	order_date: dateParts(createdAt).date,
	order_time: dateParts(createdAt).time,
	customer,
	phone: text(client.phone) || text(address.phone),
	customer_email: text(address.email) || null,
	customer_comment: Array.isArray(order.comments) ? order.comments.map(text).filter(Boolean).join('\n') || null : null,
	platform: 'Каста',
	status: (orderStatuses[text(status.type)] ?? text(status.type)) || 'Новый',
	shipping: calculatedShipping ?? Number(existing?.shipping ?? 0),
	acquiring: Number(existing?.acquiring ?? 0),
	acquiring_percent: existing?.acquiring_percent ?? null,
	delivery: {
		carrier: deliveryCarrier,
		ttn: deliveryTtn,
		recipient: nameOf(address) || customer,
		recipientPhone: text(address.phone) || text(client.phone),
		city: text(asRecord(address.city).name),
		address: deliveryAddress,
		status: deliveryStatus,
		payer: blackUsed || order.kasta_pays_for_shipping === true ? 'Каста' : text(currentDelivery.payer) || 'Не указано',
		blackUsed,
		customerDeliveryFee: deliveryFee,
		paymentAmount: typeof currentDelivery.paymentAmount === 'number' ? currentDelivery.paymentAmount : undefined,
		paymentMethod: text(order.requested_payment_method),
		paymentStatus: text(order.card_payment_state),
        ...preserveTracking(currentDelivery, deliveryCarrier, deliveryTtn),
		printCheckedAt: text(currentDelivery.printCheckedAt) || undefined,
		printedAt: text(currentDelivery.printedAt) || undefined
	}
})
    let orderId = existing?.id
    if (orderId) { await admin.from('crm_orders').update(data).eq('id', orderId); updated += 1 }
    else { const { data: inserted } = await admin.from('crm_orders').insert(data).select('id').single(); orderId = inserted?.id; created += 1 }
    if (!orderId) continue
    const { data: previousItems } = await admin.from('crm_order_items').select('position, product_name, size, image_url, cost, cost_usd, royalty_percent, royalty_amount').eq('order_id', orderId)
    const byPosition = new Map((previousItems ?? []).map((item) => [item.position, item]))
    if (!items.length) continue
    await admin.from('crm_order_items').delete().eq('order_id', orderId)
    const savedItems = []
    for (const [position, item] of items.entries()) {
      const previous = byPosition.get(position)
      const quantity = itemQuantity(item)
      const uniqueSkuId = text(pick(item, 'unique_sku_id', 'offer_id', 'product_id', 'id'))
      const supplierCode = text(item.supplier_code)
      const feedImage = feedImages.get(uniqueSkuId) || feedImages.get(supplierCode)
      const directRoyalty = royaltyPercent(item.royalty)
      const needsCatalogRoyalty = targetOrderId || previous === undefined
      const apiRoyalty = directRoyalty || (needsCatalogRoyalty ? await kastaRoyaltyForItem(kastaToken, item, royaltyCache) : undefined)
      if (targetOrderId) {
        console.log(JSON.stringify({ kastaOrderItem: {
          orderId: kastaId,
          supplierCode,
          barcode: itemBarcode(item),
          paidPrice: number(item.paid_price),
          newPrice: number(item.new_price),
          bonus: itemBonus(item),
          directRoyalty,
          apiRoyalty,
        } }))
      }
      savedItems.push({ order_id: orderId, position, product_name: text(pick(item, 'name', 'title', 'product_name', 'kind', 'supplier_code')), size: text(pick(item, 'kasta_size', 'size')), image_url: itemImage(item) || feedImage || previous?.image_url || null, quantity, price: itemPrice(item) || number(item.total_price) / quantity, cost: number(previous?.cost), cost_usd: number(previous?.cost_usd), royalty_percent: apiRoyalty ?? previous?.royalty_percent ?? 0, royalty_amount: previous?.royalty_amount ?? null })
    }
    await admin.from('crm_order_items').insert(savedItems)
  }
  return Response.json({ ok: true, received: orders.length, created, updated, skipped, remains: number(payload.remains) }, { headers: corsHeaders })
})
