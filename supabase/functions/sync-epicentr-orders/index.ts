import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type EpicentrOrder = {
  id: string
  externalId?: string | null
  number: string
  createdAt: string
  statusCode: string
  comment?: string
  subtotal: number
  payed: boolean
  items: Array<{
    offerId: string
    title: string
    image?: string
    quantity: number
    price: number
  }>
  address?: {
    firstName?: string
    lastName?: string
    patronymic?: string
    phone?: string
    email?: string
    isAlternateRecipient?: boolean
    address?: unknown
    city?: unknown
    recipient?: { firstName?: string; lastName?: string; patronymic?: string; phone?: string }
    shipment?: {
      provider?: string
      paymentProvider?: string
      paymentStatus?: string
      status?: string
      statusCode?: string
      shipmentStatus?: string
      number?: string
      address?: unknown
      settlement?: unknown
      city?: unknown
      office?: unknown
      settlementId?: string
      officeId?: string
      deliveryPrice?: number
    }
  }
}

const statusNames: Record<string, string> = {
  new: 'Новий',
  confirmed_by_seller: 'Підтверджено продавцем',
  confirmed_by_merchant: 'Підтверджено продавцем',
  confirmed: 'Підтверджено',
  sent: 'Відправлено',
  ready_for_pickup: 'Готово до видачі',
  finished: 'Завершено',
  closed: 'Закрито',
  canceled: 'Скасовано',
  returned: 'Повернено',
  return_request: 'Запит на повернення',
  canceled_by_seller: 'Скасовано продавцем',
}

function formatOrderDate(value: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', year: 'numeric',
  }).formatToParts(new Date(value))
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('day')}.${get('month')}.${get('year')}`
}

function formatOrderTime(value: string) {
  return new Intl.DateTimeFormat('uk-UA', {
    timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value))
}

function fullName(person?: { firstName?: string; lastName?: string; patronymic?: string }) {
  return [person?.lastName, person?.firstName, person?.patronymic].filter(Boolean).join(' ')
}

function readableText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (!value || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  const preferred = ['title', 'name', 'label', 'number', 'officeNumber', 'address', 'street', 'fullName']
  const result = preferred.map((key) => readableText(record[key])).filter(Boolean)
  if (result.length) return result.join(', ')
  return Object.values(record)
    .filter((item) => typeof item === 'string' || typeof item === 'number')
    .map(String)
    .join(', ')
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function itemSize(item: Record<string, unknown>) {
  const explicitSize = readableText(item.size) || readableText(item.variation) || readableText(item.option) || readableText(item.characteristics)
  if (explicitSize) return explicitSize
  const title = readableText(item.title)
  const labelled = title.match(/(?:розмір|размер|р\.)\s*([\d]+(?:\s*[-/]\s*[\d]+)?)/i)?.[1]?.replace(/\s/g, '')
  if (labelled) return labelled
  // In the order API the chosen clothing variation is appended to the item title,
  // e.g. "Reis Foreco-TS L (717-720-L)". Catalogue attributes are deliberately
  // not used here because they may describe the parent product rather than the order line.
  return title.match(/(?:^|[\s,])((?:XXS|XS|S|M|L|XL|XXL|XXXL|4XL|5XL|\d{1,3})(?=\s*(?:\(|$)))/i)?.[1] ?? ''
}

function apiNumber(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value !== 'string') return 0
  const normalized = value.replace(/\s/g, '').replace(',', '.').match(/-?\d+(?:\.\d+)?/)?.[0]
  return normalized ? Number(normalized) : 0
}

const epicentrRoyaltyRates: Array<{ category: string; percent: number }> = [
  { category: 'наколінники будівельні', percent: 13 },
  { category: 'рукавиці робочі', percent: 13 },
  { category: 'спецвзуття', percent: 13 },
  { category: 'спецодяг', percent: 13 },
  { category: 'світловідбиваючі жилети', percent: 12 },
  { category: 'гумові чоботи', percent: 15 },
  { category: 'рукавички зимові', percent: 15 },
  { category: 'дощовики і пончо туристичні', percent: 15 },
  { category: 'сабо', percent: 15 },
]

function normalizeCategoryTitle(value: string) {
  return value
    .toLocaleLowerCase('uk-UA')
    .replace(/[’'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function detectedRoyaltyCategory(item: Record<string, unknown>) {
  const product = asRecord(item.product)
  const categorySources = [
    item.category ?? item.categoryName ?? item.category_name ?? item.productCategory ??
      product.category ?? product.categoryName ?? product.category_name ?? product.productCategory,
    ...(Array.isArray(product.categories) ? product.categories : []),
  ]
  const category = categorySources
    .map((source) => {
      const record = asRecord(source)
      const translations = Array.isArray(record.translations) ? record.translations : []
      return translations.map((translation) => readableText(asRecord(translation).title)).join(' ') || readableText(source)
    })
    .join(' ')
  const normalizedCategory = normalizeCategoryTitle(category)
  return epicentrRoyaltyRates.find((rate) => normalizedCategory.includes(rate.category))
}

function categoryRoyaltyPercent(item: Record<string, unknown>) {
  return detectedRoyaltyCategory(item)?.percent
}

type NormalizedItem = { title: string; quantity: number; price: number; raw: Record<string, unknown> }

function epicentrOfferId(item: Record<string, unknown>) {
  return readableText(item.offerId ?? item.offer_id ?? item.productId ?? item.product_id)
}

function normalizeItems(order: unknown): NormalizedItem[] {
  const source = asRecord(order)
  const nestedOrder = asRecord(source.order)
  const candidates = [source.items, source.products, source.orderItems, nestedOrder.items, nestedOrder.products]
  const rawItems = candidates.find(Array.isArray) as unknown[] | undefined
  return (rawItems ?? []).map((raw) => {
    const item = asRecord(raw)
    const quantity = apiNumber(item.quantity ?? item.qty ?? item.count ?? 1) || 1
    const subtotal = apiNumber(item.subtotal ?? item.total ?? item.amount)
    const directPrice = apiNumber(item.price ?? item.unitPrice ?? item.unit_price)
    return {
      title: readableText(item.title) || readableText(item.name) || readableText(item.productName) || readableText(asRecord(item.product).title),
      quantity,
      price: directPrice || (subtotal ? subtotal / quantity : 0),
      raw: item,
    }
  }).filter((item) => Boolean(item.title))
}

function extractOrder(payload: unknown): Record<string, unknown> {
  const root = asRecord(payload)
  const data = asRecord(root.data)
  const nestedOrder = asRecord(data.order)
  if (Object.keys(nestedOrder).length) return nestedOrder
  if (Object.keys(data).length) return data
  const order = asRecord(root.order)
  return Object.keys(order).length ? order : root
}

async function deliveryReference(url: string, token: string) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  if (!response.ok) return ''
  const payload: unknown = await response.json()
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return readableText((payload as { data: unknown }).data)
  }
  return readableText(payload)
}

function deliveryPointLabel(provider: string | undefined, number: string) {
  if (!number) return ''
  if (provider === 'parcel_box_epicentr') return `Поштомат Епіцентр №${number}`
  if (provider === 'nova_poshta') {
    return number.length === 5 && !number.startsWith('0') ? `Поштомат №${number}` : `Відділення №${number}`
  }
  return `Відділення №${number}`
}

function formatDeliveryPointAddress(provider: string | undefined, officeId: string, address: string) {
  if (!address) return deliveryPointLabel(provider, officeId)
  if (provider === 'parcel_box_epicentr') {
    const officeNumber = /^\d{1,5}$/.test(officeId) ? officeId : ''
    const labelledNumber = address.match(/(?:поштомат(?:\s+Епіцентр)?\s*(?:№\s*)?)(\d{1,5})/i)?.[1]
    const trailingNumber = address.match(/,\s*(\d{1,5})$/)?.[1]
    const number = officeNumber || labelledNumber || trailingNumber || ''
    if (number) {
      const plainAddress = address
        .replace(/поштомат(?:\s+Епіцентр)?\s*(?:№\s*)?\d{1,5}\s*,?\s*/i, '')
        .replace(/,\s*\d{1,5}$/, '')
        .trim()
      return `${deliveryPointLabel(provider, number)}${plainAddress ? `, ${plainAddress}` : ''}`
    }
  }
  if (/(?:відділення|поштомат)[^,]*№/i.test(address)) return address.replace(/№\s+(\d)/g, '№$1')

  // В Новой почте: 1–3 цифры — отделение, 5 цифр — почтомат.
  // Пятизначные коды с ведущим нулём Эпицентр использует и для отделений.
  const trailingNumber = address.match(/(?:,\s*)(\d{1,3}|\d{5})$/)?.[1]
  const leadingNumber = address.match(/^\s*(\d{1,3}|\d{5})\s*,?\s*/)?.[1]
  const officeNumber = /^(?:\d{1,3}|\d{5})$/.test(officeId) ? officeId : ''
  const number = officeNumber || trailingNumber || leadingNumber || ''
  if (!number) return address

  let plainAddress = address
  if (trailingNumber) plainAddress = plainAddress.replace(/(?:,\s*)(?:\d{1,3}|\d{5})$/, '')
  if (leadingNumber) plainAddress = plainAddress.replace(/^\s*(?:\d{1,3}|\d{5})\s*,?\s*/, '')
  const label = deliveryPointLabel(provider, number)
  return `${label}${plainAddress ? `, ${plainAddress}` : ''}`
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const epicentrToken = Deno.env.get('EPICENTR_API_TOKEN')
  const authorization = request.headers.get('Authorization')
  if (!url || !anonKey || !serviceKey || !epicentrToken || !authorization) {
    return Response.json({ ok: false, message: 'Не хватает настроек функции.' }, { status: 500, headers: corsHeaders })
  }

  const admin = createClient(url, serviceKey)
  const { data: cronSecret } = await admin.rpc('get_crm_sync_cron_secret')
  const isScheduledRequest = typeof cronSecret === 'string' && authorization === `Bearer ${cronSecret}`
  const auth = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } })
  const { data: { user } } = await auth.auth.getUser()
  if (!isScheduledRequest && !user) return Response.json({ ok: false, message: 'Нужен вход в CRM.' }, { status: 401, headers: corsHeaders })
  if (!isScheduledRequest && user.email?.toLowerCase() === 'guest@gmail.com') {
    return Response.json({ ok: false, message: 'Гостевой аккаунт не может запускать синхронизацию.' }, { status: 403, headers: corsHeaders })
  }

  const body = await request.json().catch(() => ({})) as { externalId?: unknown; full?: unknown; manual?: unknown }
  const requestedExternalId = typeof body.externalId === 'string' ? body.externalId : ''
  const fullSync = body.full === true
  const manual = body.manual && typeof body.manual === 'object' ? body.manual as Record<string, unknown> : {}
  const manualItems = Array.isArray(manual.items) ? manual.items.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object')) : []
  let orders: EpicentrOrder[] = []

  if (requestedExternalId) {
    const response = await fetch(`https://merchant-api.epicentrm.com.ua/v6/oms/orders/${requestedExternalId}`, {
      headers: { Authorization: `Bearer ${epicentrToken}`, Accept: 'application/json' },
    })
    if (!response.ok) {
      return Response.json({ ok: false, message: 'Эпицентр не отдал этот заказ.', status: response.status }, { status: 502, headers: corsHeaders })
    }
    const payload: unknown = await response.json()
    const item = extractOrder(payload)
    orders = [{ ...item, id: readableText(item.id) || requestedExternalId, items: (item.items as EpicentrOrder['items']) ?? [] } as EpicentrOrder]
  } else {
    const response = await fetch('https://merchant-api.epicentrm.com.ua/v4/oms/orders', {
      headers: { Authorization: `Bearer ${epicentrToken}`, Accept: 'application/json' },
    })
    if (!response.ok) {
      return Response.json({ ok: false, message: 'Эпицентр не отдал заказы.', status: response.status }, { status: 502, headers: corsHeaders })
    }

    const payload = await response.json() as { items?: EpicentrOrder[] }
    orders = payload.items ?? []
  }
  let created = 0
  let updated = 0
  let skipped = 0
  const offerRows = orders.flatMap((order) => normalizeItems(order).map((item) => ({
    offer_id: epicentrOfferId(item.raw),
    product_title: item.title,
  }))).filter((item) => item.offer_id)
  if (offerRows.length) {
    await admin.from('crm_epicentr_product_categories').upsert(offerRows, {
      onConflict: 'offer_id',
      ignoreDuplicates: true,
    })
  }
  const offerIds = [...new Set(offerRows.map((item) => item.offer_id))]
  const [{ data: mappedProducts }, { data: royaltyCategories }, { data: mappedRates }] = await Promise.all([
    offerIds.length
      ? admin.from('crm_epicentr_product_categories').select('offer_id, category_id').in('offer_id', offerIds)
      : Promise.resolve({ data: [] }),
    admin.from('crm_epicentr_royalty_categories').select('id, title'),
    admin.from('crm_epicentr_royalty_rates').select('category_id, effective_from, royalty_percent'),
  ])
  const categoryByOffer = new Map((mappedProducts ?? []).map((item) => [item.offer_id, item.category_id]))
  const categoryIdByTitle = new Map(
    (royaltyCategories ?? []).map((category) => [normalizeCategoryTitle(String(category.title)), category.id]),
  )
  const ratesByCategory = new Map<string, Array<{ effective_from: string; royalty_percent: number }>>()
  for (const rate of mappedRates ?? []) {
    if (!rate.category_id) continue
    const existingRates = ratesByCategory.get(rate.category_id) ?? []
    existingRates.push({ effective_from: String(rate.effective_from), royalty_percent: Number(rate.royalty_percent) })
    ratesByCategory.set(rate.category_id, existingRates)
  }
  const mappedRoyaltyPercent = (item: Record<string, unknown>, orderDate: string) => {
    const categoryId = categoryByOffer.get(epicentrOfferId(item))
    if (!categoryId) return undefined
    const orderDay = orderDate.slice(0, 10)
    return (ratesByCategory.get(categoryId) ?? [])
      .filter((rate) => rate.effective_from <= orderDay)
      .sort((first, second) => second.effective_from.localeCompare(first.effective_from))[0]?.royalty_percent
  }
  const ensureDetectedCategory = async (item: Record<string, unknown>) => {
    const offerId = epicentrOfferId(item)
    if (!offerId || categoryByOffer.get(offerId)) return
    const detectedCategory = detectedRoyaltyCategory(item)
    const categoryId = detectedCategory ? categoryIdByTitle.get(detectedCategory.category) : undefined
    if (!categoryId) return
    const { data: updatedMapping } = await admin
      .from('crm_epicentr_product_categories')
      .update({ category_id: categoryId, updated_at: new Date().toISOString() })
      .eq('offer_id', offerId)
      .is('category_id', null)
      .select('category_id')
      .maybeSingle()
    if (updatedMapping?.category_id) {
      categoryByOffer.set(offerId, updatedMapping.category_id)
      return
    }
    const { data: currentMapping } = await admin
      .from('crm_epicentr_product_categories')
      .select('category_id')
      .eq('offer_id', offerId)
      .maybeSingle()
    if (currentMapping?.category_id) categoryByOffer.set(offerId, currentMapping.category_id)
  }
  const knownExternalIds = new Set<string>()
  if (!requestedExternalId && orders.length) {
    const externalIds = orders.map((order) => order.id).filter(Boolean)
    const { data: existingOrders } = await admin.from('crm_orders').select('external_id').in('external_id', externalIds)
    for (const row of existingOrders ?? []) if (row.external_id) knownExternalIds.add(row.external_id)
  }

  for (const order of orders) {
    if (!requestedExternalId && !fullSync && knownExternalIds.has(order.id)) {
      skipped += 1
      continue
    }
    const detailResponse = await fetch(`https://merchant-api.epicentrm.com.ua/v6/oms/orders/${order.id}`, {
      headers: { Authorization: `Bearer ${epicentrToken}`, Accept: 'application/json' },
    })
    const detailPayload: unknown = detailResponse.ok ? await detailResponse.json() : undefined
    const detail = extractOrder(detailPayload)
    const source: EpicentrOrder = {
      ...order,
      ...detail,
      address: detail.address ?? order.address,
      items: detail.items ?? order.items,
    }
    const externalId = source.id
    const existing = requestedExternalId || fullSync
      ? await admin.from('crm_orders')
        .select('id, shipping, acquiring, acquiring_percent, delivery')
        .eq('external_id', externalId).maybeSingle()
      : { data: null }
    // Массовая кнопка добавляет только отсутствующие заказы. Обновление
    // существующего заказа остаётся отдельным действием в его карточке.
    const shipment = source.address?.shipment
    const recipient = source.address?.recipient
    let city = readableText(shipment?.settlement) || readableText(shipment?.city) || readableText(source.address?.city)
    let address = readableText(shipment?.address) || readableText(shipment?.office) || readableText(source.address?.address)
    if (shipment?.provider && shipment.settlementId) {
      const provider = encodeURIComponent(shipment.provider)
      const settlementId = encodeURIComponent(shipment.settlementId)
      city ||= await deliveryReference(
        `https://merchant-api.epicentrm.com.ua/v3/deliveries/providers/${provider}/settlements/${settlementId}`,
        epicentrToken,
      )
      if (shipment.officeId) {
        const officeId = encodeURIComponent(shipment.officeId)
        // Адрес в самом заказе нередко приходит без номера отделения.
        // Поэтому справочник отделений имеет приоритет над этим текстом.
        const officeAddress = await deliveryReference(
          `https://merchant-api.epicentrm.com.ua/v3/deliveries/providers/${provider}/settlements/${settlementId}/offices/${officeId}`,
          epicentrToken,
        )
        if (officeAddress) address = officeAddress
      }
    }
    const officeNumber = String(shipment?.officeId ?? '')
    address = formatDeliveryPointAddress(shipment?.provider, officeNumber, address)
    const customer = fullName(source.address) || fullName(recipient) || 'Покупатель Эпицентра'
    const recipientName = fullName(recipient) || customer
    const statusCode = readableText(source.statusCode ?? (source as unknown as Record<string, unknown>).status)
    const status = (statusNames[statusCode.toLowerCase()] ?? statusCode) || 'Не указан'
    const orderNumber = Number(source.number)
    const previousDelivery = (existing.data?.delivery ?? {}) as Record<string, unknown>
    const apiDeliveryStatus = readableText(shipment?.status) || readableText(shipment?.statusCode) || readableText(shipment?.shipmentStatus)
    // Для Эпицентра статус finished означает, что покупатель уже получил
    // отправление. Если отдельный статус перевозчика отсутствует, это более
    // точный источник, чем старое значение «Запланировано» в CRM.
    const deliveryStatus = ['finished', 'completed'].includes(statusCode.toLowerCase())
      ? 'Получено'
      : apiDeliveryStatus ||
        (typeof previousDelivery.status === 'string' && previousDelivery.status !== status ? previousDelivery.status : 'Заплановано')
    const paymentAmount = typeof previousDelivery.paymentAmount === 'number' ? previousDelivery.paymentAmount : undefined
    const hasShippingFromApi = shipment?.deliveryPrice !== undefined && shipment.deliveryPrice !== null && shipment.deliveryPrice !== ''
    const data = {
      external_id: externalId,
      order_number: Number.isFinite(orderNumber) ? orderNumber : 0,
      order_date: formatOrderDate(source.createdAt),
      order_time: formatOrderTime(source.createdAt),
      customer,
      phone: source.address?.phone ?? recipient?.phone ?? '',
      customer_email: source.address?.email ?? null,
      customer_comment: source.comment ?? null,
      platform: 'Эпицентр',
      status,
      // Берём фактическую стоимость доставки из API. Если площадка её не отдала,
      // сохраняем вручную внесённую сумму в CRM.
      shipping: hasShippingFromApi ? Number(shipment?.deliveryPrice) : Number(existing.data?.shipping ?? 0),
      // Эквайринг вводится в CRM, а API площадки его не возвращает.
      acquiring: manual.acquiring !== undefined ? Number(manual.acquiring) : Number(existing.data?.acquiring ?? 0),
      acquiring_percent: manual.acquiringPercent !== undefined ? (manual.acquiringPercent === null ? null : Number(manual.acquiringPercent)) : existing.data?.acquiring_percent ?? null,
      delivery: {
        carrier: shipment?.provider || 'Эпицентр',
        ttn: shipment?.number ?? '',
        recipient: recipientName,
        recipientPhone: recipient?.phone || source.address?.phone || '',
        city,
        address,
        status: deliveryStatus,
        payer: 'Не вказано',
        isAlternateRecipient: source.address?.isAlternateRecipient ?? false,
        paymentAmount,
        paymentMethod: shipment?.paymentProvider ?? '',
        paymentStatus: shipment?.paymentStatus ?? '',
        printCheckedAt: typeof previousDelivery.printCheckedAt === 'string' ? previousDelivery.printCheckedAt : undefined,
        printedAt: typeof previousDelivery.printedAt === 'string' ? previousDelivery.printedAt : undefined,
      },
    }

    let orderId = existing.data?.id
    if (orderId) {
      await admin.from('crm_orders').update(data).eq('id', orderId)
      updated += 1
    } else {
      const inserted = await admin.from('crm_orders').insert(data).select('id').single()
      orderId = inserted.data?.id
      created += 1
    }
    if (!orderId) continue

    const { data: currentItems } = await admin
      .from('crm_order_items')
      .select('position, product_name, size, cost, cost_usd, royalty_percent, royalty_amount, royalty_manual')
      .eq('order_id', orderId)
    const itemsByPositionAndName = new Map(
      (currentItems ?? []).map((item) => [`${item.position}:${item.product_name}`, item]),
    )
    const itemsByName = new Map(
      (currentItems ?? []).map((item) => [item.product_name, item]),
    )

    // Неполный ответ API не должен очищать уже сохранённые позиции заказа.
    // Заменяем их только если для каждой позиции есть название, цена и количество.
    const validItems = normalizeItems(source).filter((item) =>
      Boolean(item.title.trim()) && Number.isFinite(item.price) && Number.isFinite(item.quantity),
    )
    if (validItems.length) {
      for (const item of validItems) await ensureDetectedCategory(item.raw)
      const { error: deleteError } = await admin.from('crm_order_items').delete().eq('order_id', orderId)
      if (deleteError) {
        return Response.json({ ok: false, message: `Не удалось сохранить позиции: ${deleteError.message}` }, { status: 500, headers: corsHeaders })
      }
      const { error: insertError } = await admin.from('crm_order_items').insert(validItems.map((item, position) => {
        const snapshotItem = manualItems[position]
        // В ручной синхронизации снимок позиции приоритетнее: API иногда
        // меняет написание товара, но это не повод терять введённые финансы.
        const storedItem = itemsByPositionAndName.get(`${position}:${item.title}`) ?? itemsByName.get(item.title)
        const currentItem = snapshotItem ?? storedItem
        const savedRoyaltyPercent = currentItem?.royalty_percent ?? currentItem?.royaltyPercent
        const royaltyManual = currentItem?.royalty_manual === true || currentItem?.royaltyManual === true || storedItem?.royalty_manual === true
        const automaticRoyaltyPercent = mappedRoyaltyPercent(item.raw, source.createdAt) ?? categoryRoyaltyPercent(item.raw)
        return {
          order_id: orderId,
          position,
          product_name: item.title,
          size: itemSize(item.raw) || readableText(currentItem?.size),
          image_url: readableText(item.raw.image) || readableText(item.raw.imageUrl) || readableText(asRecord(item.raw.product).image),
          quantity: item.quantity,
          price: item.price,
          cost: Number(currentItem?.cost ?? 0),
          cost_usd: Number(currentItem?.cost_usd ?? currentItem?.costUsd ?? 0),
          royalty_percent: royaltyManual ? savedRoyaltyPercent ?? null : automaticRoyaltyPercent ?? null,
          royalty_amount: currentItem?.royalty_amount ?? currentItem?.royaltyAmount ?? null,
          royalty_manual: royaltyManual,
        }
      }))
      if (insertError) {
        return Response.json({ ok: false, message: `Не удалось записать позиции: ${insertError.message}` }, { status: 500, headers: corsHeaders })
      }
    }
  }

  return Response.json({ ok: true, received: orders.length, created, updated, skipped }, { headers: corsHeaders })
})
