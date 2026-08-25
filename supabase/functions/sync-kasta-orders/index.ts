import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type RecordValue = Record<string, unknown>

const asRecord = (value: unknown): RecordValue =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {}
const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : ''
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
  return JSON.stringify(value)
}
async function sourceHash(value: unknown) {
  const bytes = new TextEncoder().encode(stableStringify(value))
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
const same = (left: unknown, right: unknown) => stableStringify(left) === stableStringify(right)
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
  return Object.fromEntries(Object.entries(delivery).filter(([key, value]) => key.startsWith('tracking') && !['trackingLastCheckedAt', 'trackingLastError'].includes(key) && value !== undefined))
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
  const returnedItems = Array.isArray(order.returned_items) ? order.returned_items : []
  const orderedItems = Array.isArray(order.ordered_items) ? order.ordered_items : Array.isArray(order.items) ? order.items : []
  const cancelledItems = Array.isArray(order.cancelled_items) ? order.cancelled_items : []
  const items = isCancelled && cancelledItems.length
    ? cancelledItems
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

function calculateKastaDeliveryCost(orderDate: string, customerDeliveryFee: number, orderAmount: number, blackUsed: boolean, deliveryWasNotCompleted: boolean): number | undefined {
  if (deliveryWasNotCompleted) return 0
  if (!blackUsed) return 0
  const tariff = [...TARIF_SCHEDULE]
    .sort((a, b) => b.effective_date.localeCompare(a.effective_date))
    .find((candidate) => orderDate >= candidate.effective_date)
  if (!tariff) return undefined
  if (customerDeliveryFee > 0) return 0
  return tariff.rates.find((rate) => orderAmount <= rate.max)?.cost ?? 0
}

function hasCancellationOrReturnStatus(order: RecordValue): boolean {
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
  if (!response.ok) throw { status: response.status, retryAfter: response.headers.get('Retry-After') }
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
  const { data: { user } } = isScheduledRequest ? { data: { user: null } } : await auth.auth.getUser()
  if (!isScheduledRequest && !user) return Response.json({ ok: false, message: 'Нужен вход в CRM.' }, { status: 401, headers: corsHeaders })
  if (!isScheduledRequest && user.email?.toLowerCase() === 'guest@gmail.com') return Response.json({ ok: false, message: 'Гостевой аккаунт не может запускать синхронизацию.' }, { status: 403, headers: corsHeaders })

  const body = await request.json().catch(() => ({})) as { full?: unknown; externalId?: unknown }
  const fullSync = body.full === true
  const targetOrderId = text(body.externalId).replace(/^kasta:/, '')
  const royaltyCache = new Map<string, number>()
  let feedImagesPromise: Promise<Map<string, string>> | undefined
  const getFeedImages = () => feedImagesPromise ??= imagesFromFeed(Deno.env.get('PROM_PRODUCTS_FEED_URL'))
  let received = 0
  let created = 0
  let updated = 0
  let skippedUnchanged = 0
  let deletedSkipped = 0
  let finalRemains = 0
  const changedOrderIds = new Set<string>()

  const processOrdersPage = async (orders: RecordValue[]): Promise<Response | null> => {
    received += orders.length
    if (!orders.length) return null

    const hashes = new Map(await Promise.all(orders.map(async (order) => [`kasta:${text(order.id)}`, await sourceHash(order)] as const)))
    const externalIds = [...hashes.keys()]
    const { data: deletedOrders, error: deletedOrdersError } = externalIds.length
      ? await admin
        .from('crm_deleted_marketplace_orders')
        .select('external_id')
        .eq('platform', 'Каста')
        .in('external_id', externalIds)
      : { data: [], error: null }
    if (deletedOrdersError) {
      return Response.json({ ok: false, message: `Не удалось проверить удалённые Kasta-заказы (${deletedOrdersError.message}).` }, { status: 500, headers: corsHeaders })
    }
    const deletedExternalIds = new Set((deletedOrders ?? []).map((order) => text(order.external_id)))
    const { data: syncRows, error: syncStateError } = externalIds.length
      ? await admin.from('crm_marketplace_order_sync_state').select('external_id, source_hash').eq('platform', 'Каста').in('external_id', externalIds)
      : { data: [], error: null }
    if (syncStateError) return Response.json({ ok: false, message: syncStateError.message }, { status: 500, headers: corsHeaders })
    const stateByExternalId = new Map((syncRows ?? []).map((row) => [row.external_id, row]))
    const candidates = orders.filter((order) => targetOrderId || fullSync || stateByExternalId.get(`kasta:${text(order.id)}`)?.source_hash !== hashes.get(`kasta:${text(order.id)}`))
    skippedUnchanged += orders.length - candidates.length
    if (!candidates.length) return null

    const candidateExternalIds = candidates.map((order) => `kasta:${text(order.id)}`)
    const { data: existingRows, error: existingError } = await admin.from('crm_orders').select('*').in('external_id', candidateExternalIds)
    if (existingError) return Response.json({ ok: false, message: existingError.message }, { status: 500, headers: corsHeaders })
    const existingByExternalId = new Map((existingRows ?? []).map((row) => [row.external_id, row]))
    const { data: existingItems, error: itemsError } = (existingRows ?? []).length
      ? await admin.from('crm_order_items').select('order_id, position, product_name, size, image_url, quantity, price, cost, cost_usd, royalty_percent, royalty_amount').in('order_id', existingRows.map((row) => row.id))
      : { data: [], error: null }
    if (itemsError) return Response.json({ ok: false, message: itemsError.message }, { status: 500, headers: corsHeaders })
    const itemsByOrder = new Map<string, RecordValue[]>()
    for (const item of existingItems ?? []) itemsByOrder.set(item.order_id, [...(itemsByOrder.get(item.order_id) ?? []), item])
    const feedImages = await getFeedImages()

    for (const order of candidates) {
      const kastaId = text(order.id)
      if (!kastaId) continue
      const externalId = `kasta:${kastaId}`
      if (deletedExternalIds.has(externalId)) { deletedSkipped += 1; continue }
      const existing = existingByExternalId.get(externalId)
      const client = asRecord(order.client)
      const address = asRecord(order.shipping_address)
      const delivery = asRecord(order.delivery_properties)
      const status = latestStatus(order)
      const createdStatus = (Array.isArray(order.statuses) ? order.statuses.map(asRecord) : []).find((item) => text(item.type) === 'Created') ?? status
      const createdAt = text(createdStatus.created_at) || text(status.created_at)
      const items = itemRows(order)
      const deliveryFee = customerDeliveryFee(order, delivery)
      const currentDelivery = asRecord(existing?.delivery)
      const receivedDate = receivedAt(order) || text(currentDelivery.receivedAt)
      const blackUsed = delivery.black_used === true
      // A cancellation/return makes delivery free only when the buyer never received
      // the order. Once receipt happened, Kasta co-finance remains an actual expense.
      const tariffDate = orderDateKey(receivedDate || createdAt)
      const deliveryWasNotCompleted = hasCancellationOrReturnStatus(order) && !receivedDate
      const calculatedShipping = calculateKastaDeliveryCost(tariffDate, deliveryFee, orderAmount(order, items), blackUsed, deliveryWasNotCompleted)
      const deliveryStatus = receivedDate
        ? 'Получено'
        : text(status.type) === 'Cancelled'
          ? 'Скасовано'
          : text(status.type) === 'AnnouncedForDelivery' || text(status.type) === 'SentToDelivery'
            ? 'В дороге'
            : 'Запланировано'
      const customer = nameOf(client) || nameOf(address) || 'Покупатель Касты'
      const deliveryAddress = [text(asRecord(address.city).name), text(asRecord(address.warehouse).name)].filter(Boolean).join(', ')
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
          receivedAt: receivedDate || undefined,
          ...preserveTracking(currentDelivery, deliveryCarrier, deliveryTtn),
          printCheckedAt: text(currentDelivery.printCheckedAt) || undefined,
          printedAt: text(currentDelivery.printedAt) || undefined,
        },
      })
      let orderId = existing?.id
      const orderChanged = !existing || !same(Object.fromEntries(Object.keys(data).map((key) => [key, existing[key]])), data)
      if (orderId && orderChanged) {
        const { error } = await admin.from('crm_orders').update(data).eq('id', orderId)
        if (error) return Response.json({ ok: false, message: error.message }, { status: 500, headers: corsHeaders })
        updated += 1
        changedOrderIds.add(orderId)
      } else if (!orderId) {
        const { data: inserted, error } = await admin.from('crm_orders').insert(data).select('id').single()
        if (error || !inserted?.id) return Response.json({ ok: false, message: error?.message ?? 'Не удалось создать заказ Каста.' }, { status: 500, headers: corsHeaders })
        orderId = inserted.id
        created += 1
        changedOrderIds.add(orderId)
      }
      if (!orderId) continue
      const previousItems = itemsByOrder.get(orderId) ?? []
      const byPosition = new Map((previousItems ?? []).map((item) => [item.position, item]))
      if (!items.length) continue
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
      const comparableSaved = savedItems.map(({ order_id: _orderId, ...item }) => item)
      const comparableExisting = previousItems.map(({ order_id: _orderId, ...item }) => item).sort((left, right) => number(left.position) - number(right.position))
      if (!same(comparableSaved, comparableExisting)) {
        const { error: deleteError } = await admin.from('crm_order_items').delete().eq('order_id', orderId)
        if (deleteError) return Response.json({ ok: false, message: deleteError.message }, { status: 500, headers: corsHeaders })
        const { error: insertError } = await admin.from('crm_order_items').insert(savedItems)
        if (insertError) return Response.json({ ok: false, message: insertError.message }, { status: 500, headers: corsHeaders })
        if (!orderChanged) {
          updated += 1
          changedOrderIds.add(orderId)
        }
      }
      const { error: stateError } = await admin.from('crm_marketplace_order_sync_state').upsert({ platform: 'Каста', external_id: externalId, order_id: orderId, source_hash: hashes.get(externalId), synced_at: new Date().toISOString() })
      if (stateError) return Response.json({ ok: false, message: stateError.message }, { status: 500, headers: corsHeaders })
    }
    return null
  }

  try {
    if (targetOrderId) {
      const payload = await fetchKastaOrders(kastaToken, new URLSearchParams({ limit: '100', order_id: targetOrderId }))
      finalRemains = number(payload.remains)
      const pageError = await processOrdersPage(Array.isArray(payload.items) ? payload.items.map(asRecord) : [])
      if (pageError) return pageError
    } else {
      const { data: savedCursor, error: cursorError } = await admin.from('crm_sync_cursors').select('cursor, updated_at').eq('source', 'kasta_orders_incremental_v2').maybeSingle()
      if (cursorError) return Response.json({ ok: false, message: cursorError.message }, { status: 500, headers: corsHeaders })
      const age = savedCursor ? Date.now() - Date.parse(savedCursor.updated_at) : Infinity
      if (!fullSync && age < 120_000) return Response.json({ ok: true, skipped: 'cooldown', retryAfterSeconds: Math.ceil((120_000 - age) / 1000), received: 0, created: 0, updated: 0, skippedUnchanged: 0, changedOrderIds: [] }, { headers: corsHeaders })

      let cursor = fullSync ? '' : text(savedCursor?.cursor)
      const previousCycleUpdatedAt = text(savedCursor?.updated_at) || '1970-01-01T00:00:00.000Z'
      let firstPage = true
      while (true) {
        const query = new URLSearchParams({ limit: '100' })
        if (cursor) query.set('cursor', cursor)
        else if (fullSync || (!savedCursor && firstPage)) query.set('from', new Date(Date.now() - 7 * 86_400_000).toISOString())

        const payload = await fetchKastaOrders(kastaToken, query)
        finalRemains = number(payload.remains)
        const pageCursor = text(payload.cursor)
        const pageError = await processOrdersPage(Array.isArray(payload.items) ? payload.items.map(asRecord) : [])
        if (pageError) return pageError

        if (!fullSync) {
          if (!pageCursor) {
            return Response.json({ ok: false, message: 'Каста не вернула cursor для успешно обработанной incremental page.' }, { status: 502, headers: corsHeaders })
          }
          // Persist progress after every page, but only start the 120-second cooldown
          // after the whole incremental cycle has completed successfully.
          const cursorRow: RecordValue = {
            source: 'kasta_orders_incremental_v2',
            cursor: pageCursor,
            updated_at: finalRemains <= 0 ? new Date().toISOString() : previousCycleUpdatedAt,
          }
          const { error: saveCursorError } = await admin.from('crm_sync_cursors').upsert(cursorRow)
          if (saveCursorError) return Response.json({ ok: false, message: saveCursorError.message }, { status: 500, headers: corsHeaders })
        }

        if (finalRemains <= 0) break
        if (!pageCursor) return Response.json({ ok: false, message: 'Каста вернула remains > 0 без cursor.' }, { status: 502, headers: corsHeaders })
        cursor = pageCursor
        firstPage = false
      }
    }
  } catch (error) {
    const failed = error as { status?: number; retryAfter?: string }
    const status = failed.status === 429 ? 429 : 502
    return Response.json({ ok: false, message: `Каста не отдала заказы (${failed.status ?? 'ошибка'}).` }, { status, headers: { ...corsHeaders, ...(failed.retryAfter ? { 'Retry-After': failed.retryAfter } : {}) } })
  }

  return Response.json({ ok: true, received, created, updated, skipped: skippedUnchanged, skippedUnchanged, deletedSkipped, changedOrderIds: [...changedOrderIds], remains: finalRemains }, { headers: corsHeaders })
})
