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
  subtotal: number
  payed: boolean
  items: Array<{
    offerId: string
    title: string
    quantity: number
    price: number
  }>
  address?: {
    firstName?: string
    lastName?: string
    patronymic?: string
    phone?: string
    address?: unknown
    city?: unknown
    recipient?: { firstName?: string; lastName?: string; patronymic?: string; phone?: string }
    shipment?: {
      provider?: string
      number?: string
      address?: unknown
      settlement?: unknown
      city?: unknown
      office?: unknown
      deliveryPrice?: number
    }
  }
}

const statusNames: Record<string, string> = {
  new: 'Новий',
  confirmed_by_seller: 'Підтверджено продавцем',
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
  const preferred = ['title', 'name', 'label', 'address', 'street', 'fullName']
  const result = preferred.map((key) => readableText(record[key])).filter(Boolean)
  if (result.length) return result.join(', ')
  return Object.values(record)
    .filter((item) => typeof item === 'string' || typeof item === 'number')
    .map(String)
    .join(', ')
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

  const auth = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } })
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return Response.json({ ok: false, message: 'Нужен вход в CRM.' }, { status: 401, headers: corsHeaders })
  if (user.email?.toLowerCase() === 'guest@gmail.com') {
    return Response.json({ ok: false, message: 'Гостевой аккаунт не может запускать синхронизацию.' }, { status: 403, headers: corsHeaders })
  }

  const response = await fetch('https://merchant-api.epicentrm.com.ua/v4/oms/orders', {
    headers: { Authorization: `Bearer ${epicentrToken}`, Accept: 'application/json' },
  })
  if (!response.ok) {
    return Response.json({ ok: false, message: 'Эпицентр не отдал заказы.', status: response.status }, { status: 502, headers: corsHeaders })
  }

  const payload = await response.json() as { items?: EpicentrOrder[] }
  const orders = payload.items ?? []
  const admin = createClient(url, serviceKey)
  let created = 0
  let updated = 0

  for (const order of orders) {
    const detailResponse = await fetch(`https://merchant-api.epicentrm.com.ua/v6/oms/orders/${order.id}`, {
      headers: { Authorization: `Bearer ${epicentrToken}`, Accept: 'application/json' },
    })
    const detailPayload: unknown = detailResponse.ok ? await detailResponse.json() : undefined
    const detail = detailPayload && typeof detailPayload === 'object'
      ? ((detailPayload as { data?: Partial<EpicentrOrder> }).data ?? detailPayload as Partial<EpicentrOrder>)
      : {}
    const source: EpicentrOrder = {
      ...order,
      ...detail,
      address: detail.address ?? order.address,
      items: detail.items ?? order.items,
    }
    const externalId = source.id
    const existing = await admin.from('crm_orders').select('id').eq('external_id', externalId).maybeSingle()
    const shipment = source.address?.shipment
    const recipient = source.address?.recipient
    const customer = fullName(source.address) || fullName(recipient) || 'Покупатель Эпицентра'
    const recipientName = fullName(recipient) || customer
    const status = statusNames[source.statusCode.toLowerCase()] ?? source.statusCode
    const orderNumber = Number(source.number)
    const data = {
      external_id: externalId,
      order_number: Number.isFinite(orderNumber) ? orderNumber : 0,
      order_date: formatOrderDate(source.createdAt),
      order_time: formatOrderTime(source.createdAt),
      customer,
      phone: source.address?.phone ?? recipient?.phone ?? '',
      platform: 'Эпик',
      status,
      shipping: Number(shipment?.deliveryPrice ?? 0),
      acquiring: 0,
      acquiring_percent: null,
      delivery: {
        carrier: shipment?.provider || 'Эпицентр',
        ttn: shipment?.number ?? '',
        recipient: recipientName,
        recipientPhone: recipient?.phone || source.address?.phone || '',
        city: readableText(shipment?.settlement) || readableText(shipment?.city) || readableText(source.address?.city),
        address: readableText(shipment?.address) || readableText(shipment?.office) || readableText(source.address?.address),
        status,
        payer: 'Не вказано',
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

    await admin.from('crm_order_items').delete().eq('order_id', orderId)
    if (source.items.length) {
      await admin.from('crm_order_items').insert(source.items.map((item, position) => ({
        order_id: orderId,
        position,
        product_name: item.title,
        size: '',
        quantity: Number(item.quantity ?? 1),
        price: Number(item.price ?? 0),
        cost: 0,
        royalty_percent: null,
        royalty_amount: null,
      })))
    }
  }

  return Response.json({ ok: true, received: orders.length, created, updated }, { headers: corsHeaders })
})
