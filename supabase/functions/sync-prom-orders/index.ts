import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { loadPlatformPriceCostSnapshots, promoteLegacyPriceLink, resolvedOrderItemCost } from '../_shared/price-cost.ts'
import { marketplaceMatchesCarrierDelivery, marketplaceMustKeepCarrierDelivery, marketplaceReplacementHistory } from '../_shared/delivery-history.ts'
import { paymentDetails } from '../_shared/payment-details.ts'

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
const number = (value: unknown) => Number(text(value).replace(/\s/g, '').replace(',', '.').replace(/[^\d.-]/g, '')) || 0
const pick = (record: RecordValue, ...keys: string[]) => keys.map((key) => record[key]).find((value) => value !== undefined && value !== null && value !== '')
function promProductKey(item: RecordValue) {
  // Себестоимость привязывается к товару, а не к размерной вариации.
  // SKU в заказах Prom — артикул; rzid/variation_id/id — идентификатор варианта и здесь не используется.
  const sku = text(item.sku).trim()
  if (sku) return `sku:${sku}`
  const externalId = text(item.external_id).trim()
  if (externalId) return `external:${externalId}`
  const productId = text(pick(item, 'product_id', 'productId')).trim()
  if (productId) return `product:${productId}`
  return ''
}
function preserveTracking(
  delivery: RecordValue,
  carrier: string,
  ttn: string,
  destination: { city: string; address: string },
): RecordValue {
  if (!marketplaceMatchesCarrierDelivery(delivery, carrier, ttn))
    return marketplaceReplacementHistory(delivery, carrier, ttn, destination)
  const keepCarrierDelivery = marketplaceMustKeepCarrierDelivery(delivery, carrier, ttn)
  const preserved = Object.fromEntries(
    Object.entries(delivery).filter(([key, value]) =>
      (key.startsWith('tracking') && !['trackingLastCheckedAt', 'trackingLastError'].includes(key) && value !== undefined) ||
      (['shipmentHistory', 'ttnHistory', 'addressHistory'].includes(key) && value !== undefined),
    ),
  )
  if (keepCarrierDelivery) {
    preserved.ttn = delivery.ttn
    preserved.city = delivery.city
    preserved.address = delivery.address
  } else {
    if (text(delivery.trackingDestinationCity)) preserved.city = delivery.city
    if (text(delivery.trackingDestinationAddress)) preserved.address = delivery.address
  }
  return preserved
}
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

function promClientName(client: RecordValue) {
  return [
    text(pick(client, 'client_last_name', 'last_name', 'lastName', 'surname')),
    text(pick(client, 'client_first_name', 'first_name', 'firstName', 'name_first')),
    text(pick(client, 'client_second_name', 'middle_name', 'middleName', 'second_name', 'patronymic')),
  ].filter(Boolean).join(' ') || readable(pick(client, 'full_name', 'fullName', 'name'))
}

function promClientPhone(client: RecordValue) {
  return text(pick(client, 'phone', 'client_phone', 'phone_number', 'phoneNumber', 'mobile', 'mobile_phone'))
}

function promClientEmail(client: RecordValue) {
  return text(pick(client, 'email', 'client_email', 'email_address', 'emailAddress'))
}

async function promClientById(
  clientId: string,
  promToken: string,
  cache: Map<string, Promise<RecordValue | null>>,
): Promise<RecordValue | null> {
  if (!clientId) return null
  const cached = cache.get(clientId)
  if (cached) return cached

  const pending = (async () => {
    try {
      const response = await fetch(`https://my.prom.ua/api/v1/clients/${encodeURIComponent(clientId)}`, {
        headers: { Authorization: `Bearer ${promToken}`, Accept: 'application/json' },
      })
      if (!response.ok) return null
      const payload = asRecord(await response.json())
      const client = asRecord(payload.client ?? payload.data ?? payload)
      return Object.keys(client).length ? client : null
    } catch {
      return null
    }
  })()

  cache.set(clientId, pending)
  return pending
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

type ProductTranslationResult = { name: string; retry: boolean }

function promTranslationProductId(item: RecordValue) {
  const productId = text(pick(item, 'product_id', 'productId')).trim()
  if (productId) return productId
  return text(pick(item, 'rzid', 'variation_id', 'id')).trim()
}

async function ukrainianProductNameById(
  productId: string,
  promToken: string,
  cache: Map<string, Promise<ProductTranslationResult>>,
) {
  const cached = cache.get(productId)
  if (cached) return cached

  const pending = (async (): Promise<ProductTranslationResult> => {
    try {
      const endpoint = new URL(`https://my.prom.ua/api/v1/products/translation/${encodeURIComponent(productId)}`)
      endpoint.searchParams.set('lang', 'uk')
      const response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${promToken}`, Accept: 'application/json' },
      })
      if (!response.ok) {
        const retry = response.status === 408 || response.status === 429 || response.status >= 500
        return { name: '', retry }
      }
      const payload = asRecord(await response.json())
      const translation = asRecord(payload.translation)
      const data = asRecord(payload.data)
      const name = (
        readable(pick(payload, 'name', 'title', 'product_name')) ||
        readable(pick(translation, 'name', 'title', 'product_name')) ||
        readable(pick(data, 'name', 'title', 'product_name'))
      ).trim()
      return { name, retry: false }
    } catch {
      return { name: '', retry: true }
    }
  })()

  cache.set(productId, pending)
  return pending
}

async function resolvedUkrainianProductName(
  item: RecordValue,
  fallbackName: string,
  promToken: string,
  cache: Map<string, Promise<ProductTranslationResult>>,
): Promise<ProductTranslationResult> {
  const direct = readable(pick(item, 'name_ua', 'name_uk', 'product_name_ua', 'product_name_uk')).trim()
  if (direct) return { name: direct, retry: false }

  const productId = promTranslationProductId(item)
  if (!productId) return { name: fallbackName, retry: false }
  const translated = await ukrainianProductNameById(productId, promToken, cache)
  return { name: translated.name || fallbackName, retry: translated.retry }
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

type FeedProductInfo = { size: string; imageUrl: string }
type PromFeedProducts = {
  byOfferId: Map<string, FeedProductInfo>
  byUniqueAlias: Map<string, FeedProductInfo>
}

function promFeedIdentifiers(item: RecordValue) {
  return [...new Set([
    text(pick(item, 'rzid', 'variation_id', 'id')).trim(),
    text(pick(item, 'product_id', 'productId')).trim(),
    text(item.external_id).trim(),
    text(item.sku).trim(),
  ].filter(Boolean))]
}

function productFromPromFeed(item: RecordValue, feedProducts: PromFeedProducts) {
  const identifiers = promFeedIdentifiers(item)
  for (const identifier of identifiers) {
    const exact = feedProducts.byOfferId.get(identifier)
    if (exact) return exact
  }
  for (const identifier of identifiers) {
    const alias = feedProducts.byUniqueAlias.get(identifier)
    if (alias) return alias
  }
  return undefined
}

async function resolvedProductSize(
  item: RecordValue,
  name: string,
  promToken: string,
  feedProducts: PromFeedProducts,
  productCache: Map<string, string>,
  useProductFallback: boolean,
) {
  const fromOrder = productSize(item, name)
  if (fromOrder) return fromOrder

  const fromFeed = productFromPromFeed(item, feedProducts)?.size
  if (fromFeed) return fromFeed

  // Product API fallback is reserved for an individual order refresh, so a bulk
  // "new orders" scan does not make one extra request per item.
  const rzid = text(pick(item, 'rzid', 'variation_id', 'id'))
  if (!rzid || !useProductFallback) return ''
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
  if (/(?:упаков|пакув|короб|pack|box)/i.test(normalized)) return false
  return ['розмір', 'размер', 'size'].some((label) => {
    if (!normalized.startsWith(label)) return false
    const suffix = normalized.slice(label.length)
    return suffix === '' || /^[\s:(_/-]/.test(suffix)
  })
}

function decodeXmlText(value: string) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
}

function productFromFeedBody(body: string): FeedProductInfo {
  const imageUrl = decodeXmlText(body.match(/<picture\b[^>]*>([\s\S]*?)<\/picture>/i)?.[1] ?? '')
  for (const param of body.matchAll(/<param\b[^>]*\bname=(["'])([^"']+)\1[^>]*>([\s\S]*?)<\/param>/gi)) {
    if (isSizeParameter(decodeXmlText(param[2]))) return { size: decodeXmlText(param[3]), imageUrl }
  }
  return { size: '', imageUrl }
}

async function productsFromPromFeed(feedUrl: string | undefined): Promise<PromFeedProducts> {
  const byOfferId = new Map<string, FeedProductInfo>()
  const byUniqueAlias = new Map<string, FeedProductInfo>()
  if (!feedUrl) return { byOfferId, byUniqueAlias }
  const aliasOwner = new Map<string, string>()
  const ambiguousAliases = new Set<string>()
  try {
    const response = await fetch(feedUrl)
    if (!response.ok) return { byOfferId, byUniqueAlias }
    const xml = await response.text()
    for (const match of xml.matchAll(/<offer\b[^>]*\bid=(["'])([^"']+)\1[^>]*>([\s\S]*?)<\/offer>/gi)) {
      const offerId = match[2].trim()
      const body = match[3]
      const product = productFromFeedBody(body)
      if (!product.size && !product.imageUrl) continue
      byOfferId.set(offerId, product)

      const vendorCode = decodeXmlText(body.match(/<vendorCode\b[^>]*>([\s\S]*?)<\/vendorCode>/i)?.[1] ?? '')
      if (!vendorCode || ambiguousAliases.has(vendorCode)) continue
      const owner = aliasOwner.get(vendorCode)
      if (owner && owner !== offerId) {
        byUniqueAlias.delete(vendorCode)
        ambiguousAliases.add(vendorCode)
        continue
      }
      aliasOwner.set(vendorCode, offerId)
      byUniqueAlias.set(vendorCode, product)
    }
  } catch {
    // The marketplace sync continues with order data if the catalogue feed is unavailable.
  }
  return { byOfferId, byUniqueAlias }
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
  const { data: { user } } = isScheduledRequest ? { data: { user: null } } : await auth.auth.getUser()
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
  const hashes = new Map(await Promise.all(orders.map(async (order) => [`prom:${text(order.id)}`, await sourceHash(order)] as const)))
  const externalIds = [...hashes.keys()].filter((id) => id !== 'prom:')
  const { data: syncRows, error: syncStateError } = externalIds.length
    ? await admin.from('crm_marketplace_order_sync_state').select('external_id, source_hash, order_id').eq('platform', 'Пром').in('external_id', externalIds)
    : { data: [] }
  if (syncStateError) return Response.json({ ok: false, message: syncStateError.message }, { status: 500, headers: corsHeaders })
  const stateByExternalId = new Map((syncRows ?? []).map((row) => [row.external_id, row]))
  const candidates = orders.filter((order) => requestedExternalId || fullSync || stateByExternalId.get(`prom:${text(order.id)}`)?.source_hash !== hashes.get(`prom:${text(order.id)}`))
  const skippedUnchanged = orders.length - candidates.length
  if (!candidates.length) return Response.json({ ok: true, received: orders.length, created: 0, updated: 0, skipped: skippedUnchanged, skippedUnchanged, changedOrderIds: [] }, { headers: corsHeaders })
  const candidateExternalIds = candidates.map((order) => `prom:${text(order.id)}`)
  const { data: existingRows, error: existingError } = await admin.from('crm_orders').select('*').in('external_id', candidateExternalIds)
  if (existingError) return Response.json({ ok: false, message: existingError.message }, { status: 500, headers: corsHeaders })
  const existingByExternalId = new Map((existingRows ?? []).map((row) => [row.external_id, row]))
  const candidateOrderIds = (existingRows ?? []).map((row) => row.id)
  const { data: existingItems, error: existingItemsError } = candidateOrderIds.length
    ? await admin.from('crm_order_items').select('order_id, position, product_name, size, image_url, quantity, price, cost, cost_usd, royalty_percent, royalty_amount, royalty_manual, marketplace_product_key, cost_manual, price_item_id').in('order_id', candidateOrderIds)
    : { data: [] }
  if (existingItemsError) return Response.json({ ok: false, message: existingItemsError.message }, { status: 500, headers: corsHeaders })
  const itemsByOrder = new Map<string, RecordValue[]>()
  for (const item of existingItems ?? []) itemsByOrder.set(item.order_id, [...(itemsByOrder.get(item.order_id) ?? []), item])
  let priceCostSnapshots: Awaited<ReturnType<typeof loadPlatformPriceCostSnapshots>>
  try {
    priceCostSnapshots = await loadPlatformPriceCostSnapshots(admin, 'Пром')
  } catch (error) {
    return Response.json({ ok: false, message: `Не удалось загрузить привязки себестоимости Prom: ${error instanceof Error ? error.message : String(error)}` }, { status: 500, headers: corsHeaders })
  }
  const feedProducts = await productsFromPromFeed(Deno.env.get('PROM_PRODUCTS_FEED_URL'))
  let created = 0
  let updated = 0
  const skipped = skippedUnchanged
  const changedOrderIds: string[] = []
  const productSizeCache = new Map<string, string>()
  const productNameCache = new Map<string, Promise<ProductTranslationResult>>()
  const promClientCache = new Map<string, Promise<RecordValue | null>>()
  for (const order of candidates) {
    const promId = text(order.id)
    if (!promId) continue
    const externalId = `prom:${promId}`
    const existing = existingByExternalId.get(externalId) ?? null
    const existingOrder = asRecord(existing)
    const clientId = text(pick(order, 'client_id', 'clientId')).trim()
    const shouldResolvePromClient = Boolean(clientId) && (!existing || Boolean(requestedExternalId))
    const promClient = shouldResolvePromClient
      ? await promClientById(clientId, promToken, promClientCache)
      : null
    const orderCustomer = customerName(order)
    const orderPhone = text(order.phone) || text(order.client_phone)
    const orderEmail = text(order.email) || text(order.client_email)
    const buyerName = promClientName(promClient ?? {}) || (clientId ? text(existingOrder.customer) : '') || orderCustomer
    const buyerPhone = promClientPhone(promClient ?? {}) || (clientId ? text(existingOrder.phone) : '') || orderPhone
    const buyerEmail = promClientEmail(promClient ?? {}) || (clientId ? text(existingOrder.customer_email) : '') || orderEmail
    // Массовая кнопка ищет только новые заказы. Старые обновляются только
    // отдельной кнопкой в карточке конкретного заказа.
    const previousDelivery = asRecord(existing?.delivery)
    const rawDelivery = asRecord(pick(order, 'delivery', 'delivery_data'))
    const deliveryProvider = asRecord(order.delivery_provider_data)
    const providerRecipientAddress = asRecord(deliveryProvider.recipient_address)
    const paymentData = asRecord(order.payment_data)
    const savedPayment = paymentDetails(previousDelivery, {
      paymentMethod: readable(pick(order, 'payment_option', 'payment_method', 'payment_type', 'payment')),
      paymentStatus:
        text(pick(paymentData, 'status', 'payment_status', 'state')) ||
        text(pick(order, 'payment_status', 'payment_state')),
    })
    const trackingNumber =
      text(pick(order, 'delivery_declaration_number', 'delivery_declaration_id', 'declaration_number', 'tracking_number')) ||
      text(pick(rawDelivery, 'declaration_number', 'declaration_id', 'tracking_number', 'ttn')) ||
      findDeliveryTracking(order) ||
      text(previousDelivery.ttn)
    const deliveryCarrier = readable(pick(order, 'delivery_option', 'delivery_service')) ||
      readable(pick(rawDelivery, 'service', 'provider', 'option')) ||
      text(previousDelivery.carrier) ||
      'Prom'
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
    const hasManualShipping = previousDelivery.shippingSource === 'manual'
    const shippingSource = hasManualShipping
      ? 'manual'
      : hasSellerDeliveryCost
        ? 'seller-api'
        : promoSellerDeliveryCost !== undefined
          ? 'prom-promo'
          : 'none'
    const { date, time } = dateParts(order.date_created ?? order.created_at)
    const data = {
      external_id: externalId,
      order_number: number(order.id), order_date: date, order_time: time,
      customer: buyerName, phone: buyerPhone,
      customer_email: buyerEmail || null,
      customer_comment: text(order.client_notes) || text(order.comment) || null,
      platform: 'Пром', status: orderStatus,
      shipping: hasManualShipping
        ? number(existing?.shipping)
        : hasSellerDeliveryCost
          ? number(sellerDeliveryCost)
          : promoSellerDeliveryCost ?? 0,
      acquiring: manual.acquiring !== undefined ? number(manual.acquiring) : number(existing?.acquiring),
      acquiring_percent: manual.acquiringPercent !== undefined ? (manual.acquiringPercent === null ? null : number(manual.acquiringPercent)) : existing?.acquiring_percent ?? null,
      delivery: {
        carrier: deliveryCarrier,
        ttn: trackingNumber,
        recipient: deliveryRecipientName(order, rawDelivery, deliveryProvider) || customerName(order),
        recipientPhone: deliveryRecipientPhone(order, rawDelivery, deliveryProvider) || text(order.phone) || text(order.client_phone),
        city: deliveryCity, address: deliveryAddress,
        ttnHistory: ttnHistory.length ? ttnHistory : undefined,
        addressHistory: addressHistory.length ? addressHistory : undefined,
        status: deliveryStatus, payer,
        ...savedPayment,
        rozetkaPayOperationIds: Array.isArray(previousDelivery.rozetkaPayOperationIds)
          ? previousDelivery.rozetkaPayOperationIds.filter((value) => typeof value === 'string')
          : undefined,
        hasWebsiteCommission: websiteOrderCommission > 0,
        shippingSource,
        ...preserveTracking(previousDelivery, deliveryCarrier, trackingNumber, { city: deliveryCity, address: deliveryAddress }),
        printCheckedAt: text(previousDelivery.printCheckedAt) || undefined,
        printedAt: text(previousDelivery.printedAt) || undefined,
      },
    }
    let orderId = existing?.id
    const orderChanged = !existing || !same(Object.fromEntries(Object.keys(data).map((key) => [key, existing[key]])), data)
    if (orderId && orderChanged) { const { error } = await admin.from('crm_orders').update(data).eq('id', orderId); if (error) return Response.json({ ok: false, message: error.message }, { status: 500, headers: corsHeaders }); updated += 1; changedOrderIds.push(orderId) }
    else if (!orderId) { const { data: inserted, error } = await admin.from('crm_orders').insert(data).select('id').single(); if (error || !inserted?.id) return Response.json({ ok: false, message: error?.message ?? 'Не удалось создать заказ Prom.' }, { status: 500, headers: corsHeaders }); orderId = inserted.id; created += 1 }
    if (!orderId) continue
    if (!existing) changedOrderIds.push(orderId)

    const currentItems = itemsByOrder.get(orderId) ?? []
    const byPosition = new Map((currentItems ?? []).map((item) => [item.position, item]))
    const byName = new Map((currentItems ?? []).map((item) => [item.product_name, item]))
    const variantKey = (marketplaceProductKey: string, size: string) =>
      marketplaceProductKey && size ? `${marketplaceProductKey}\u0000${size.trim().toLowerCase()}` : ''
    const byVariant = new Map(
      currentItems
        .map((item) => [
          variantKey(text(item.marketplace_product_key), text(item.size)),
          item,
        ] as const)
        .filter(([key]) => Boolean(key)),
    )
    const manualByVariant = new Map(
      manualItems
        .map((item) => [
          variantKey(text(item.marketplaceProductKey), text(item.size)),
          item,
        ] as const)
        .filter(([key]) => Boolean(key)),
    )
    const items = sourceItems(order)
    const itemPrice = (item: RecordValue) => {
      const quantity = number(pick(item, 'quantity', 'amount')) || 1
      return firstNumber(pick(item, 'price', 'price_uah', 'priceUAH', 'unit_price', 'base_price', 'cost'), number(pick(item, 'total_price', 'subtotal', 'sum')) / quantity)
    }
    const itemsAmount = items.reduce((total, item) => total + itemPrice(item) * (number(pick(item, 'quantity', 'amount')) || 1), 0)
    const orderCommission = number(asRecord(order.cpa_commission).amount)
    let needsTranslationRetry = false
    if (items.length) {
      const itemRows = await Promise.all(items.map(async (item, position) => {
      const sourceName = text(item.name) || text(item.product_name) || 'Товар Prom'
      const localizedName = await resolvedUkrainianProductName(item, sourceName, promToken, productNameCache)
      if (localizedName.retry) needsTranslationRetry = true
      const name = localizedName.name
      const quantity = number(pick(item, 'quantity', 'amount')) || 1
      const price = itemPrice(item)
      const apiSize = await resolvedProductSize(
        item,
        sourceName,
        promToken,
        feedProducts,
        productSizeCache,
        Boolean(requestedExternalId),
      )
      const marketplaceProductKey = promProductKey(item)
      const currentVariantKey = variantKey(marketplaceProductKey, apiSize)
      const manualItem =
        (currentVariantKey ? manualByVariant.get(currentVariantKey) : undefined) ??
        manualItems.find(
          (candidate) =>
            text(candidate.name) === name && (!apiSize || text(candidate.size) === apiSize),
        )
      const matchesCurrentVariant = (candidate: RecordValue | undefined) =>
        Boolean(candidate) &&
        (!marketplaceProductKey ||
          text(candidate?.marketplace_product_key ?? candidate?.marketplaceProductKey) ===
            marketplaceProductKey) &&
        (!apiSize || text(candidate?.size) === apiSize)
      const namePrevious = byName.get(name)
      const positionPrevious = byPosition.get(position)
      const previous =
        (currentVariantKey ? byVariant.get(currentVariantKey) : undefined) ??
        (matchesCurrentVariant(namePrevious) ? namePrevious : undefined) ??
        (matchesCurrentVariant(positionPrevious) ? positionPrevious : undefined)
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
      const royaltyManual =
        manualItem?.royaltyManual === true || previous?.royalty_manual === true
      const preservedRoyaltyPercent =
        manualItem?.royaltyManual === true
          ? manualItem.royaltyPercent
          : previous?.royalty_percent
      const preservedRoyaltyAmount =
        manualItem?.royaltyManual === true
          ? manualItem.royaltyAmount
          : previous?.royalty_amount
      // A missing value in Prom's response must never erase a manually saved size.
      const size = apiSize || text(previous?.size) || ''
      const previousMarketplaceProductKey = text(
        previous?.marketplace_product_key ?? previous?.marketplaceProductKey,
      )
      const resolvedMarketplaceProductKey = marketplaceProductKey || previousMarketplaceProductKey
      let linkedPriceCost = priceCostSnapshots.get(resolvedMarketplaceProductKey)
      if (
        !linkedPriceCost &&
        resolvedMarketplaceProductKey &&
        previousMarketplaceProductKey &&
        resolvedMarketplaceProductKey !== previousMarketplaceProductKey
      ) {
        const legacyPriceCost = priceCostSnapshots.get(previousMarketplaceProductKey)
        if (legacyPriceCost) {
          const promoted = await promoteLegacyPriceLink(
            admin,
            'Пром',
            previousMarketplaceProductKey,
            resolvedMarketplaceProductKey,
            legacyPriceCost,
            name,
          )
          if (promoted) priceCostSnapshots.set(resolvedMarketplaceProductKey, legacyPriceCost)
          linkedPriceCost = legacyPriceCost
        }
      }
      const imageUrl =
        productFromPromFeed(item, feedProducts)?.imageUrl ||
        text(pick(item, 'image', 'image_url', 'imageUrl')) ||
        text(previous?.image_url)
      const resolvedCost = resolvedOrderItemCost(previous, linkedPriceCost)
      return {
        order_id: orderId,
        position,
        product_name: name,
        size,
        image_url: imageUrl || null,
        quantity,
        price,
        cost: resolvedCost.cost,
        cost_usd: resolvedCost.costUsd,
        marketplace_product_key: resolvedMarketplaceProductKey || null,
        cost_manual: resolvedCost.costManual,
        price_item_id: resolvedCost.priceItemId,
        royalty_percent: royaltyManual ? preservedRoyaltyPercent ?? null : royaltyPercent,
        royalty_amount: royaltyManual ? preservedRoyaltyAmount ?? null : royaltyAmount,
        royalty_manual: royaltyManual,
      }
      }))
      const comparableRows = itemRows.map(({ order_id: _orderId, ...item }) => item)
      const comparableCurrent = currentItems.map(({ order_id: _orderId, ...item }) => item).sort((left, right) => number(left.position) - number(right.position))
      if (!same(comparableRows, comparableCurrent)) {
        const { error: deleteError } = await admin.from('crm_order_items').delete().eq('order_id', orderId)
        if (deleteError) return Response.json({ ok: false, message: deleteError.message }, { status: 500, headers: corsHeaders })
        const { error: insertError } = await admin.from('crm_order_items').insert(itemRows)
        if (insertError) return Response.json({ ok: false, message: insertError.message }, { status: 500, headers: corsHeaders })
        if (!orderChanged) updated += 1
        changedOrderIds.push(orderId)
      } else if (orderChanged) changedOrderIds.push(orderId)
    }
    const sourceHashValue = hashes.get(externalId)
    const syncStateHash = needsTranslationRetry ? `retry:${sourceHashValue ?? ''}` : sourceHashValue
    const { error: stateError } = await admin.from('crm_marketplace_order_sync_state').upsert({ platform: 'Пром', external_id: externalId, order_id: orderId, source_hash: syncStateHash, synced_at: new Date().toISOString() })
    if (stateError) return Response.json({ ok: false, message: stateError.message }, { status: 500, headers: corsHeaders })
  }
  return Response.json({ ok: true, received: orders.length, created, updated, skipped, skippedUnchanged: skipped, changedOrderIds: [...new Set(changedOrderIds)] }, { headers: corsHeaders })
})
