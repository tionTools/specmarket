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
  pending: 'Новий',
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

function displayDeliveryStatus(status: string) {
  const names: Record<string, string> = {
    initial: 'Заплановано',
  }
  return names[status.toLowerCase()] ?? status
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

function historyValues(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : []
}

function historyKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function uniqueHistory(values: string[]): string[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    const normalized = historyKey(value)
    if (!normalized || seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })
}

function fullDeliveryAddress(city: string, address: string): string {
  return [city, address].filter(Boolean).join(', ')
}

function promRecipientAddress(value: unknown): string {
  const address = asRecord(value)
  const street = readable(pick(address, 'address', 'full_address', 'street_name', 'street'))
  const building = text(pick(address, 'building_number', 'house_number', 'building'))
  const apartment = text(pick(address, 'apartment_number', 'apartment', 'flat'))
  return [street, building && `буд. ${building}`, apartment && `кв. ${apartment}`].filter(Boolean).join(', ')
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
function orderLevelCommission(value: unknown, depth = 0): number {
  if (depth > 4 || Array.isArray(value)) return 0
  const record = asRecord(value)
  return Object.entries(record).reduce((total, [key, candidate]) => {
    // type=2 в prosale_commission — точная метка Prom «Комиссия за заказ с сайта».
    // Это фиксированная комиссия всего заказа, а не комиссия каталога по позиции.
    if (/prosale/i.test(key)) {
      const commission = asRecord(candidate)
      const title = readable(commission.title).toLowerCase()
      if (number(commission.type) === 2 || /(?:с сайта|з сайту|site|website)/i.test(title)) {
        return total + number(pick(commission, 'value', 'amount', 'price'))
      }
      return total
    }
    // CPA/каталог относятся к позиции и не должны дублироваться на уровне заказа.
    if (/(?:cpa|catalog)/i.test(key)) return total
    if (/(?:commission|royalty)/i.test(key)) {
      const amount = number(candidate) || number(pick(asRecord(candidate), 'amount', 'price', 'value'))
      return total + amount
    }
    if (/(?:product|item|position)/i.test(key)) return total
    return total + orderLevelCommission(candidate, depth + 1)
  }, 0)
}

function dateParts(value: unknown) {
  const source = text(value)
  // Prom sometimes returns a UTC timestamp such as `2026-08-11T18:56:00+00:00`.
  // Preserve a plain local timestamp, but convert every timestamp carrying a
  // timezone suffix to Kyiv before saving it in the CRM.
  const match = source.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/)
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

function recipientName(value: unknown): string {
  const record = asRecord(value)
  const fullName = [
    text(pick(record, 'last_name', 'lastName', 'surname')),
    text(pick(record, 'first_name', 'firstName', 'name_first')),
    text(pick(record, 'middle_name', 'middleName', 'second_name', 'patronymic')),
  ].filter(Boolean).join(' ')
  return fullName || readable(pick(record, 'full_name', 'fullName', 'name', 'title', 'value')) || text(value)
}

function recipientPhone(value: unknown): string {
  const record = asRecord(value)
  return text(pick(record, 'phone', 'phone_number', 'phoneNumber', 'mobile', 'mobile_phone'))
}

function deliveryRecipientName(...sources: RecordValue[]): string {
  for (const source of sources) {
    const direct = readable(pick(
      source,
      'delivery_recipient_name',
      'recipient_name',
      'recipientName',
      'receiver_name',
      'receiverName',
    ))
    if (direct) return direct
    const nested = recipientName(pick(
      source,
      'delivery_recipient',
      'recipient',
      'receiver',
      'recipient_data',
      'recipientData',
      'receiver_data',
      'receiverData',
    ))
    if (nested) return nested
  }
  return ''
}

function deliveryRecipientPhone(...sources: RecordValue[]): string {
  for (const source of sources) {
    const direct = text(pick(
      source,
      'delivery_recipient_phone',
      'recipient_phone',
      'recipientPhone',
      'receiver_phone',
      'receiverPhone',
    ))
    if (direct) return direct
    const nested = recipientPhone(pick(
      source,
      'delivery_recipient',
      'recipient',
      'receiver',
      'recipient_data',
      'recipientData',
      'receiver_data',
      'receiverData',
    ))
    if (nested) return nested
  }
  return ''
}

function sourceItems(order: RecordValue) {
  const items = order.products ?? order.items
  return Array.isArray(items) ? items.map(asRecord) : []
}

function findNestedSize(value: unknown, depth = 0): string {
  if (depth > 5) return ''
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findNestedSize(child, depth + 1)
      if (found) return found
    }
    return ''
  }
  const record = asRecord(value)
  const ownLabel = readable(pick(record, 'name', 'title', 'label')).toLowerCase()
  if (/(?:size|розмір|размер)/i.test(ownLabel)) {
    const ownValue = readable(pick(record, 'value', 'values', 'text', 'description'))
    if (ownValue) return ownValue
  }
  for (const [key, candidate] of Object.entries(record)) {
    if (/(?:^size$|size|розмір|размер)/i.test(key)) {
      const found = readable(candidate) || findNestedSize(candidate, depth + 1)
      if (found) return found
    }
    if (candidate && typeof candidate === 'object') {
      const found = findNestedSize(candidate, depth + 1)
      if (found) return found
    }
  }
  return ''
}

function productSize(item: RecordValue, name: string) {
  const direct = readable(pick(item, 'variation', 'size', 'option', 'options', 'variant', 'variation_name', 'size_name'))
  if (direct) return direct
  const nested = findNestedSize(pick(item, 'product', 'product_data', 'product_variant', 'variants', 'options', 'attributes', 'characteristics', 'parameters', 'properties'))
  if (nested) return nested
  // For text modifications Prom appends the selected value to the order item
  // name: "... трикотажні 09" or "... черевики (42)". SKU stays an article
  // and is deliberately never used to determine a size.
  const trailingSize = name.match(/(?:\s|\()((?:\d{1,2}(?:[.,]\d+)?)|xxxl|xxl|xl|xs|s|m|l)\)?\s*$/i)?.[1]
  return trailingSize?.replace(',', '.') ?? ''
  /* Legacy fallback retained only for source-history context; do not execute it.
  // In Prom order lines the selected size is often the final separate value in
  // the product name, for example "... трикотажні 09" or "... Польща 42".
  // Do not infer it from SKU: SKU is an article, not a size.
  const legacyTrailingSize = name.match(/(?:^|\s)(\d{1,2})\s*$/)?.[1]
  if (legacyTrailingSize) return legacyTrailingSize
  return name.match(/(?:розмір|размер|size|р\.)\s*([\d]+(?:\s*[-/]\s*[\d]+)?|xs|s|m|l|xl|xxl|xxxl)/i)?.[1]?.replace(/\s/g, '') ?? ''
  */
}

async function resolvedProductSize(
  item: RecordValue,
  name: string,
  promToken: string,
  feedProducts: Map<string, FeedProductInfo>,
  productCache: Map<string, string>,
  useProductFallback: boolean,
) {
  const fromOrder = productSize(item, name)
  if (fromOrder) return fromOrder

  // The item id points to the Prom product variation (rzid). It is a fallback
  // only for an individual order refresh, so a bulk "new orders" scan remains fast.
  const rzid = text(pick(item, 'rzid', 'variation_id', 'id'))
  if (!rzid) return ''
  const fromFeed = feedProducts.get(rzid)?.size
  if (fromFeed) return fromFeed
  if (!useProductFallback) return ''
  if (productCache.has(rzid)) return productCache.get(rzid) ?? ''

  try {
    const response = await fetch(`https://my.prom.ua/api/v1/products/${encodeURIComponent(rzid)}`, {
      headers: { Authorization: `Bearer ${promToken}`, Accept: 'application/json' },
    })
    if (!response.ok) return ''
    const payload = asRecord(await response.json())
    const product = asRecord(payload.product ?? payload.data ?? payload)
    const resolved = productSize(product, text(product.name) || name)
    productCache.set(rzid, resolved)
    return resolved
  } catch {
    return ''
  }
}

function isSizeParameter(name: string) {
  const normalized = name.trim().toLocaleLowerCase()
  const ukrainian = String.fromCodePoint(0x440, 0x43e, 0x437, 0x43c, 0x456, 0x440)
  const russian = String.fromCodePoint(0x440, 0x430, 0x437, 0x43c, 0x435, 0x440)
  return normalized === ukrainian || normalized === russian || normalized === 'size'
}

function decodeXmlText(value: string) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
}

type FeedProductInfo = { size: string; imageUrl: string }

function productFromFeedXml(xml: string, wantedOfferId: string): FeedProductInfo {
  for (const match of xml.matchAll(/<offer\b[^>]*\bid=(["'])([^"']+)\1[^>]*>([\s\S]*?)<\/offer>/gi)) {
    if (match[2] !== wantedOfferId) continue
    const body = match[3]
    const imageUrl = decodeXmlText(body.match(/<picture\b[^>]*>([\s\S]*?)<\/picture>/i)?.[1] ?? '')
    for (const param of body.matchAll(/<param\b[^>]*\bname=(["'])([^"']+)\1[^>]*>([\s\S]*?)<\/param>/gi)) {
      if (isSizeParameter(decodeXmlText(param[2]))) return { size: decodeXmlText(param[3]), imageUrl }
    }
    return { size: '', imageUrl }
  }
  return { size: '', imageUrl: '' }
}

async function productsFromPromFeed(feedUrl: string | undefined) {
  const products = new Map<string, FeedProductInfo>()
  if (!feedUrl) return products
  try {
    const response = await fetch(feedUrl)
    if (!response.ok) return products
    const xml = await response.text()
    for (const match of xml.matchAll(/<offer\b[^>]*\bid=(["'])([^"']+)\1[^>]*>([\s\S]*?)<\/offer>/gi)) {
      const offerId = match[2]
      const product = productFromFeedXml(match[0], offerId)
      if (product.size || product.imageUrl) products.set(offerId, product)
    }
  } catch {
    // The marketplace sync continues with order data if the catalogue feed is unavailable.
  }
  return products
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

  const admin = createClient(url, serviceKey)
  const { data: cronSecret } = await admin.rpc('get_crm_sync_cron_secret')
  const isScheduledRequest = typeof cronSecret === 'string' && authorization === `Bearer ${cronSecret}`
  const auth = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } })
  const { data: { user } } = await auth.auth.getUser()
  if (!isScheduledRequest && !user) return Response.json({ ok: false, message: 'Нужен вход в CRM.' }, { status: 401, headers: corsHeaders })
  if (!isScheduledRequest && user?.email?.toLowerCase() === 'guest@gmail.com') return Response.json({ ok: false, message: 'Гостевой аккаунт не может запускать синхронизацию.' }, { status: 403, headers: corsHeaders })

  const body = await request.json().catch(() => ({})) as { externalId?: unknown; full?: unknown; manual?: unknown }
  const requestedExternalId = typeof body.externalId === 'string' ? body.externalId.replace(/^prom:/, '') : ''
  const fullSync = body.full === true
  const manual = asRecord(body.manual)
  const manualItems = Array.isArray(manual.items) ? manual.items.map(asRecord) : []
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
  const feedProducts = await productsFromPromFeed(Deno.env.get('PROM_PRODUCTS_FEED_URL'))
  let created = 0
  let updated = 0
  let skipped = 0
  const productSizeCache = new Map<string, string>()
  const knownExternalIds = new Set<string>()
  if (!requestedExternalId && orders.length) {
    const externalIds = orders.map((order) => `prom:${text(order.id)}`).filter((id) => id !== 'prom:')
    const { data: existingOrders } = await admin.from('crm_orders').select('external_id').in('external_id', externalIds)
    for (const row of existingOrders ?? []) if (row.external_id) knownExternalIds.add(row.external_id)
  }

  for (const order of orders) {
    const promId = text(order.id)
    if (!promId) continue
    const externalId = `prom:${promId}`
    if (!requestedExternalId && !fullSync && knownExternalIds.has(externalId)) {
      skipped += 1
      continue
    }
    let existing: RecordValue | null = null
    if (requestedExternalId || fullSync) {
      const { data } = await admin.from('crm_orders')
        .select('id, shipping, acquiring, acquiring_percent, delivery')
        .eq('external_id', externalId).maybeSingle()
      existing = data
    }
    // Массовая кнопка ищет только новые заказы. Старые обновляются только
    // отдельной кнопкой в карточке конкретного заказа.
    const previousDelivery = asRecord(existing?.delivery)
    const rawDelivery = asRecord(pick(order, 'delivery', 'delivery_data'))
    const deliveryProvider = asRecord(order.delivery_provider_data)
    const providerRecipientAddress = asRecord(deliveryProvider.recipient_address)
    const paymentData = asRecord(order.payment_data)
    const trackingNumber =
      text(pick(order, 'delivery_declaration_number', 'delivery_declaration_id', 'declaration_number', 'tracking_number')) ||
      text(pick(rawDelivery, 'declaration_number', 'declaration_id', 'tracking_number', 'ttn')) ||
      findDeliveryTracking(order) ||
      text(previousDelivery.ttn)
    const currentTtnHistory = uniqueHistory([
      ...historyValues(previousDelivery.ttnHistory),
      text(previousDelivery.ttn),
      trackingNumber,
    ])
    const ttnHistory = currentTtnHistory.filter((ttn) => historyKey(ttn) !== historyKey(trackingNumber))
    const rawOrderStatus = text(order.status)
    const orderStatus = (promStatusNames[rawOrderStatus.toLowerCase()] ?? rawOrderStatus) || 'Новий'
    const apiDeliveryStatus =
      readable(pick(deliveryProvider, 'status_name', 'statusName', 'unified_status', 'unifiedStatus')) ||
      readable(pick(rawDelivery, 'status', 'shipment_status', 'delivery_status', 'status_name')) ||
      text(pick(order, 'shipment_status', 'delivery_status'))
    const deliveryStatus = displayDeliveryStatus(apiDeliveryStatus) ||
      (text(previousDelivery.status) && text(previousDelivery.status) !== orderStatus ? text(previousDelivery.status) : 'Заплановано')
    const isPromFreeDelivery = order.has_order_promo_free_delivery === true
    const payer = deliveryPayer(pick(order, 'delivery_payer', 'shipping_payer', 'payer')) ||
      deliveryPayer(pick(rawDelivery, 'payer', 'delivery_payer', 'shipping_payer', 'payment_payer')) ||
      findDeliveryPayer(order) ||
      payerFromDeliveryOption(pick(order, 'delivery_option', 'delivery_service')) ||
      // В части заказов API Prom вообще не возвращает плательщика. Обычная
      // доставка Prom оплачивается получателем; промо-доставка — продавцом.
      (isPromFreeDelivery ? 'Отправитель' : 'Получатель')
    const deliveryText =
      readable(pick(order, 'delivery_address', 'address')) ||
      readable(pick(rawDelivery, 'address', 'full_address')) ||
      promRecipientAddress(providerRecipientAddress)
    const deliveryCity =
      readable(pick(order, 'delivery_city', 'city')) ||
      readable(rawDelivery.city) ||
      readable(pick(providerRecipientAddress, 'city_name', 'city')) ||
      text(previousDelivery.city)
    const deliveryAddress = deliveryText || text(previousDelivery.address)
    const currentAddressHistory = uniqueHistory([
      ...historyValues(previousDelivery.addressHistory),
      fullDeliveryAddress(text(previousDelivery.city), text(previousDelivery.address)),
      fullDeliveryAddress(deliveryCity, deliveryAddress),
    ])
    const addressHistory = currentAddressHistory.filter(
      (address) => historyKey(address) !== historyKey(fullDeliveryAddress(deliveryCity, deliveryAddress)),
    )
    // Общая «delivery_cost» Prom может быть стоимостью для покупателя.
    // Для прибыли используем только отдельную сумму, которую платит продавец.
    const sellerDeliveryCost = pick(order, 'seller_delivery_cost', 'delivery_seller_cost', 'delivery_cost_seller') ?? pick(rawDelivery, 'seller_cost', 'sender_cost', 'seller_delivery_cost')
    const hasSellerDeliveryCost = sellerDeliveryCost !== undefined && sellerDeliveryCost !== null && sellerDeliveryCost !== ''
    const websiteOrderCommission = orderLevelCommission(order)
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
      acquiring: manual.acquiring !== undefined ? number(manual.acquiring) : number(existing?.acquiring),
      acquiring_percent: manual.acquiringPercent !== undefined ? (manual.acquiringPercent === null ? null : number(manual.acquiringPercent)) : existing?.acquiring_percent ?? null,
      delivery: {
        carrier: readable(pick(order, 'delivery_option', 'delivery_service')) || readable(pick(rawDelivery, 'service', 'provider', 'option')) || 'Prom',
        ttn: trackingNumber,
        recipient: deliveryRecipientName(order, rawDelivery, deliveryProvider) || customerName(order),
        recipientPhone: deliveryRecipientPhone(order, rawDelivery, deliveryProvider) || text(order.phone) || text(order.client_phone),
        city: deliveryCity, address: deliveryAddress,
        ttnHistory: ttnHistory.length ? ttnHistory : undefined,
        addressHistory: addressHistory.length ? addressHistory : undefined,
        status: deliveryStatus, payer,
        paymentAmount: typeof previousDelivery.paymentAmount === 'number' ? previousDelivery.paymentAmount : undefined,
        paymentMethod: readable(pick(order, 'payment_option', 'payment_method', 'payment_type', 'payment')),
        paymentStatus:
          text(pick(paymentData, 'status', 'payment_status', 'state')) ||
          text(pick(order, 'payment_status', 'payment_state')) ||
          text(previousDelivery.paymentStatus),
        hasWebsiteCommission: websiteOrderCommission > 0,
        shippingSource,
        trackingStatus: text(previousDelivery.trackingStatus) || undefined,
        trackingLastCheckedAt: text(previousDelivery.trackingLastCheckedAt) || undefined,
        trackingStatusChangedAt: text(previousDelivery.trackingStatusChangedAt) || undefined,
        trackingLastError: text(previousDelivery.trackingLastError) || undefined,
        printCheckedAt: text(previousDelivery.printCheckedAt) || undefined,
        printedAt: text(previousDelivery.printedAt) || undefined,
      },
    }
    let orderId = existing?.id
    if (orderId) { await admin.from('crm_orders').update(data).eq('id', orderId); updated += 1 }
    else { const { data: inserted } = await admin.from('crm_orders').insert(data).select('id').single(); orderId = inserted?.id; created += 1 }
    if (!orderId) continue

    const { data: currentItems } = await admin.from('crm_order_items')
      .select('position, product_name, size, image_url, cost, cost_usd, royalty_percent, royalty_amount').eq('order_id', orderId)
    const byPosition = new Map((currentItems ?? []).map((item) => [item.position, item]))
    const byName = new Map((currentItems ?? []).map((item) => [item.product_name, item]))
    await admin.from('crm_order_items').delete().eq('order_id', orderId)
    const items = sourceItems(order)
    const itemPrice = (item: RecordValue) => {
      const quantity = number(pick(item, 'quantity', 'amount')) || 1
      return firstNumber(pick(item, 'price', 'price_uah', 'priceUAH', 'unit_price', 'base_price', 'cost'), number(pick(item, 'total_price', 'subtotal', 'sum')) / quantity)
    }
    const itemsAmount = items.reduce((total, item) => total + itemPrice(item) * (number(pick(item, 'quantity', 'amount')) || 1), 0)
    const orderCommission = number(asRecord(order.cpa_commission).amount)
    if (items.length) {
      const itemRows = await Promise.all(items.map(async (item, position) => {
      const name = text(item.name) || text(item.product_name) || 'Товар Prom'
      // Позиция стабильнее названия: одинаковые товары могут повторяться,
      // а название в Prom иногда меняется.
      const manualItem = manualItems[position]
      const previous = manualItem && text(manualItem.name) === name ? manualItem : byPosition.get(position) ?? byName.get(name)
      const quantity = number(pick(item, 'quantity', 'amount')) || 1
      const price = itemPrice(item)
      const itemCommission = commissionAmount(item)
      const cpaCommission = itemCommission ?? (orderCommission && itemsAmount ? orderCommission * (price * quantity / itemsAmount) : 0)
      const websiteCommission = websiteOrderCommission && itemsAmount
        ? websiteOrderCommission * (price * quantity / itemsAmount)
        : 0
      const hasApiCommission = itemCommission !== undefined || orderCommission !== 0 || websiteOrderCommission !== 0
      const royaltyAmount = hasApiCommission
        ? number(cpaCommission) + websiteCommission
        : previous?.royalty_amount ?? null
      // Комиссия сайта — фиксированная сумма, не процент от позиции.
      const royaltyPercent = hasApiCommission
        ? (number(cpaCommission) === 0 || price * quantity === 0 ? 0 : (number(cpaCommission) / (price * quantity)) * 100)
        : previous?.royalty_percent ?? null
      const apiSize = await resolvedProductSize(item, name, promToken, feedProducts, productSizeCache, Boolean(requestedExternalId))
      // A missing value in Prom's response must never erase a manually saved size.
      const size = apiSize || text(previous?.size) || ''
      const rzid = text(pick(item, 'rzid', 'variation_id', 'id'))
      const imageUrl = feedProducts.get(rzid)?.imageUrl || text(pick(item, 'image', 'image_url', 'imageUrl')) || text(previous?.image_url)
      return { order_id: orderId, position, product_name: name, size, image_url: imageUrl || null, quantity, price, cost: number(previous?.cost), cost_usd: number(previous?.cost_usd ?? previous?.costUsd), royalty_percent: previous?.royalty_percent ?? royaltyPercent, royalty_amount: previous?.royalty_amount ?? royaltyAmount }
      }))
      await admin.from('crm_order_items').insert(itemRows)
    }
  }
  return Response.json({ ok: true, received: orders.length, created, updated, skipped }, { headers: corsHeaders })
})
