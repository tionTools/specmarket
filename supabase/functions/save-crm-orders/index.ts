import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type Item = { product_name: string; size?: string; image_url?: string | null; quantity: number; price: number; cost: number; cost_usd?: number; royalty_percent?: number | null; royalty_amount?: number | null; royalty_manual?: boolean }
type SavedOrder = {
  remoteId?: string; order_number: number; order_label?: string | null; order_date: string; order_time?: string | null; customer: string; phone: string
  customer_email?: string | null; customer_comment?: string | null; internal_comment?: string | null; platform: string; status: string; shipping: number; acquiring: number
  acquiring_percent?: number | null; delivery: Record<string, unknown>; items: Item[]
}

const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : ''
const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const shipmentValue = (value: unknown) => text(value).replace(/\s/g, '').toLowerCase()
function shipmentCarrier(value: unknown) {
  const carrier = shipmentValue(value)
  if (carrier.includes('nova') || carrier.includes('нова')) return 'nova'
  if (carrier.includes('meest') || carrier.includes('міст')) return 'meest'
  if (carrier.includes('rozetka')) return 'rozetka'
  if (carrier.includes('ukr') || carrier.includes('укр')) return 'ukrposhta'
  return carrier
}
function sameShipment(left: Record<string, unknown>, right: Record<string, unknown>) {
  return shipmentValue(left.ttn) === shipmentValue(right.ttn) && shipmentCarrier(left.carrier) === shipmentCarrier(right.carrier)
}
function trackingFields(delivery: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(delivery).filter(([key, value]) => key.startsWith('tracking') && value !== undefined))
}
function withoutTracking(delivery: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(delivery).filter(([key]) => !key.startsWith('tracking')))
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const authorization = request.headers.get('Authorization')
  if (!url || !anonKey || !serviceKey || !authorization) return Response.json({ ok: false, message: 'Не хватает настроек сохранения.' }, { status: 500, headers: corsHeaders })

  const auth = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } })
  const { data: { user } } = await auth.auth.getUser()
  if (!user || user.email?.toLowerCase() === 'guest@gmail.com') return Response.json({ ok: false, message: 'Нет прав на изменение заказов.' }, { status: 403, headers: corsHeaders })

  const body = await request.json().catch(() => ({})) as { orders?: SavedOrder[] }
  const orders = Array.isArray(body.orders) ? body.orders : []
  const admin = createClient(url, serviceKey)
  const saved: Array<{ orderNumber: number; remoteId: string }> = []

  for (const order of orders) {
    let remoteId = order.remoteId
    let delivery = order.delivery
    if (remoteId) {
      const { data: current, error } = await admin.from('crm_orders').select('delivery').eq('id', remoteId).maybeSingle()
      if (error) return Response.json({ ok: false, message: error.message }, { status: 500, headers: corsHeaders })
      const currentDelivery = asRecord(current?.delivery)
      delivery = sameShipment(currentDelivery, order.delivery)
        ? { ...order.delivery, ...trackingFields(currentDelivery) }
        : withoutTracking(order.delivery)
    }
    const data = {
      order_number: order.order_number, order_label: order.order_label ?? null, order_date: order.order_date, order_time: order.order_time ?? null,
      customer: order.customer, phone: order.phone, customer_email: order.customer_email ?? null,
      customer_comment: order.customer_comment ?? null, internal_comment: order.internal_comment ?? null, platform: order.platform, status: order.status,
      shipping: order.shipping, acquiring: order.acquiring, acquiring_percent: order.acquiring_percent ?? null, delivery,
    }
    if (remoteId) {
      const { error } = await admin.from('crm_orders').update(data).eq('id', remoteId)
      if (error) return Response.json({ ok: false, message: error.message }, { status: 500, headers: corsHeaders })
    } else {
      const { data: inserted, error } = await admin.from('crm_orders').insert(data).select('id').single()
      if (error || !inserted) return Response.json({ ok: false, message: error?.message ?? 'Не удалось создать заказ.' }, { status: 500, headers: corsHeaders })
      remoteId = inserted.id
    }
    const { data: currentItems } = await admin
      .from('crm_order_items')
      .select('position, product_name, royalty_manual')
      .eq('order_id', remoteId)
    const currentItemsByPositionAndName = new Map(
      (currentItems ?? []).map((item) => [`${item.position}:${item.product_name}`, item]),
    )
    const { error: deleteError } = await admin.from('crm_order_items').delete().eq('order_id', remoteId)
    if (deleteError) return Response.json({ ok: false, message: deleteError.message }, { status: 500, headers: corsHeaders })
    if (order.items.length) {
      const { error: insertError } = await admin.from('crm_order_items').insert(order.items.map((item, position) => {
        const currentItem = currentItemsByPositionAndName.get(`${position}:${item.product_name}`)
        return {
          order_id: remoteId, position, product_name: item.product_name, size: item.size ?? '', quantity: item.quantity,
          price: item.price, image_url: item.image_url ?? null, cost: item.cost, cost_usd: item.cost_usd ?? 0,
          royalty_percent: item.royalty_percent ?? null, royalty_amount: item.royalty_amount ?? null,
          royalty_manual: item.royalty_manual ?? currentItem?.royalty_manual ?? false,
        }
      }))
      if (insertError) return Response.json({ ok: false, message: insertError.message }, { status: 500, headers: corsHeaders })
    }
    saved.push({ orderNumber: order.order_number, remoteId })
  }
  return Response.json({ ok: true, saved }, { headers: corsHeaders })
})
