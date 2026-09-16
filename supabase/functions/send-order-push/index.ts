import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  fcmTokenIsUnregistered,
  firebaseAccessToken,
  newOrderPushPayload,
  sendFirebaseDataMessage,
} from '../_shared/firebase-messaging.ts'

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : ''
const normalized = (value: unknown) => text(value).trim().toLowerCase()
const cancelledOrReturned = (value: unknown) => /скас|отмен|cancel|повер|возврат|return|refund/.test(normalized(value))

function notificationCandidate(order: { platform?: string | null; status?: string | null; delivery?: unknown }) {
  const platform = normalized(order.platform)
  if (!['пром', 'эпицентр', 'епіцентр', 'каста', 'kasta'].includes(platform)) return false
  if (cancelledOrReturned(order.status)) return false
  const delivery = order.delivery && typeof order.delivery === 'object' && !Array.isArray(order.delivery)
    ? order.delivery as Record<string, unknown>
    : {}
  return text(delivery.ttn).trim() === ''
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return Response.json({ ok: false, message: 'Method not allowed.' }, { status: 405 })

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const projectId = Deno.env.get('FIREBASE_PROJECT_ID')
  const clientEmail = Deno.env.get('FIREBASE_CLIENT_EMAIL')
  const privateKey = Deno.env.get('FIREBASE_PRIVATE_KEY')
  const authorization = request.headers.get('Authorization')
  if (!url || !serviceKey || !projectId || !clientEmail || !privateKey || !authorization) {
    return Response.json({ ok: false, message: 'Push configuration is incomplete.' }, { status: 500 })
  }

  const admin = createClient(url, serviceKey)
  const { data: cronSecret } = await admin.rpc('get_crm_sync_cron_secret')
  if (typeof cronSecret !== 'string' || authorization !== `Bearer ${cronSecret}`) {
    return Response.json({ ok: false, message: 'Unauthorized.' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({})) as { orderId?: string }
  const orderId = text(body.orderId).trim()
  if (!orderId) return Response.json({ ok: false, message: 'orderId is required.' }, { status: 400 })

  const { data: order, error: orderError } = await admin
    .from('crm_orders')
    .select('id,platform,status,order_label,order_number,customer,delivery')
    .eq('id', orderId)
    .maybeSingle()
  if (orderError) return Response.json({ ok: false, message: orderError.message }, { status: 500 })
  if (!order || !notificationCandidate(order)) return Response.json({ ok: true, skipped: true })

  let items: Array<{ price: number | null; quantity: number | null }> = []
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await admin.from('crm_order_items').select('price,quantity').eq('order_id', orderId)
    if (error) return Response.json({ ok: false, message: error.message }, { status: 500 })
    items = data ?? []
    if (items.length || attempt === 4) break
    await delay(250)
  }
  const total = items.reduce((sum, item) => sum + Number(item.price ?? 0) * Number(item.quantity ?? 0), 0)

  const { data: deviceRows, error: devicesError } = await admin
    .from('crm_push_devices')
    .select('fcm_token')
    .eq('enabled', true)
  if (devicesError) return Response.json({ ok: false, message: devicesError.message }, { status: 500 })
  const tokens = [...new Set((deviceRows ?? []).map((row) => text(row.fcm_token).trim()).filter(Boolean))]
  if (!tokens.length) return Response.json({ ok: true, sent: 0 })

  const accessToken = await firebaseAccessToken({ projectId, clientEmail, privateKey })
  const data = newOrderPushPayload(order, total)
  let sent = 0
  let failed = 0
  for (const token of tokens) {
    const response = await sendFirebaseDataMessage({ accessToken, projectId, token, data })
    if (response.ok) {
      sent += 1
      continue
    }
    failed += 1
    if (await fcmTokenIsUnregistered(response)) {
      await admin.from('crm_push_devices').delete().eq('fcm_token', token)
    }
  }

  return Response.json({ ok: failed === 0, sent, failed })
})
