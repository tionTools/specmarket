import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { extractText, getDocumentProxy } from 'npm:unpdf@1.8.1'
import {
  canonicalOrderLabelTtn,
  orderLabelCarrier,
  orderLabelMailText,
  orderLabelTtns,
} from '../_shared/order-label.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const defaultRecipient = 'prozaxist.ocean@gmail.com'
const maxPdfBytes = 5 * 1024 * 1024
const maxPdfPages = 5

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {}
}

function text(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function base64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

async function pdfText(bytes: Uint8Array) {
  const pdf = await getDocumentProxy(bytes, { maxImageSize: 16_777_216 })
  try {
    if (pdf.numPages > maxPdfPages) throw new Error('Бирка содержит слишком много страниц.')
    const extracted = await Promise.race([
      extractText(pdf, { mergePages: true }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Не удалось прочитать PDF за отведённое время.')), 10_000),
      ),
    ])
    return typeof extracted.text === 'string' ? extracted.text : extracted.text.join('\n')
  } finally {
    await pdf.destroy()
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') {
    return Response.json(
      { ok: false, message: 'Поддерживается только POST.' },
      { status: 405, headers: corsHeaders },
    )
  }

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  const resendFromEmail = Deno.env.get('RESEND_FROM_EMAIL')
  const authorization = request.headers.get('Authorization')
  if (!url || !anonKey || !serviceKey || !authorization) {
    return Response.json(
      { ok: false, message: 'Не хватает настроек Supabase.' },
      { status: 500, headers: corsHeaders },
    )
  }

  const auth = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } })
  const {
    data: { user },
  } = await auth.auth.getUser()
  if (!user) {
    return Response.json(
      { ok: false, message: 'Нужен вход в CRM.' },
      { status: 401, headers: corsHeaders },
    )
  }
  if (user.email?.toLowerCase() === 'guest@gmail.com') {
    return Response.json(
      { ok: false, message: 'Гостевой аккаунт не может отправлять бирки.' },
      { status: 403, headers: corsHeaders },
    )
  }
  if (!resendApiKey || !resendFromEmail) {
    return Response.json(
      {
        ok: false,
        message:
          'Почтовая отправка не настроена. Добавьте RESEND_API_KEY и RESEND_FROM_EMAIL в secrets Supabase.',
      },
      { status: 503, headers: corsHeaders },
    )
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return Response.json(
      { ok: false, message: 'Не удалось прочитать выбранный файл.' },
      { status: 400, headers: corsHeaders },
    )
  }

  const orderId = text(form.get('orderId'))
  const file = form.get('file')
  if (!orderId || !(file instanceof File)) {
    return Response.json(
      { ok: false, message: 'Не указан заказ или PDF-файл.' },
      { status: 400, headers: corsHeaders },
    )
  }
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    return Response.json(
      { ok: false, message: 'Можно отправлять только PDF-бирки.' },
      { status: 415, headers: corsHeaders },
    )
  }
  if (file.size <= 0 || file.size > maxPdfBytes) {
    return Response.json(
      { ok: false, message: 'Размер PDF-бирки должен быть от 1 байта до 5 МБ.' },
      { status: 413, headers: corsHeaders },
    )
  }

  const admin = createClient(url, serviceKey)
  const { data: order, error: orderError } = await admin
    .from('crm_orders')
    .select('id, delivery')
    .eq('id', orderId)
    .maybeSingle()
  if (orderError) {
    return Response.json(
      { ok: false, message: orderError.message },
      { status: 500, headers: corsHeaders },
    )
  }
  if (!order) {
    return Response.json(
      { ok: false, message: 'Заказ не найден.' },
      { status: 404, headers: corsHeaders },
    )
  }

  const delivery = record(order.delivery)
  const carrier = orderLabelCarrier(delivery.carrier)
  if (!carrier) {
    return Response.json(
      { ok: false, message: 'Для этого перевозчика отправка бирок не поддерживается.' },
      { status: 409, headers: corsHeaders },
    )
  }
  const orderTtn = canonicalOrderLabelTtn(carrier, delivery.ttn)
  if (!orderTtn) {
    return Response.json(
      { ok: false, message: 'В заказе нет ТТН. Отправка отменена.' },
      { status: 409, headers: corsHeaders },
    )
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  let extractedText = ''
  try {
    extractedText = await pdfText(bytes)
  } catch (error) {
    return Response.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? `Не удалось прочитать ТТН в бирке. Отправка отменена.\n${error.message}`
            : 'Не удалось прочитать ТТН в бирке. Отправка отменена.',
      },
      { status: 422, headers: corsHeaders },
    )
  }

  const labelTtns = orderLabelTtns(carrier, extractedText)
  if (!labelTtns.length) {
    return Response.json(
      { ok: false, message: 'Не удалось определить ТТН в бирке. Отправка отменена.' },
      { status: 422, headers: corsHeaders },
    )
  }
  if (!labelTtns.includes(orderTtn)) {
    return Response.json(
      {
        ok: false,
        message: `Бирка не соответствует заказу.\nТТН заказа: ${orderTtn}\nВ бирке: ${labelTtns[0]}`,
      },
      { status: 409, headers: corsHeaders },
    )
  }

  const { data: currentOrder, error: currentOrderError } = await admin
    .from('crm_orders')
    .select('delivery')
    .eq('id', orderId)
    .maybeSingle()
  if (currentOrderError || !currentOrder) {
    return Response.json(
      { ok: false, message: currentOrderError?.message ?? 'Не удалось перепроверить заказ.' },
      { status: 500, headers: corsHeaders },
    )
  }
  const currentDelivery = record(currentOrder.delivery)
  const currentCarrier = orderLabelCarrier(currentDelivery.carrier)
  const currentTtn = currentCarrier
    ? canonicalOrderLabelTtn(currentCarrier, currentDelivery.ttn)
    : ''
  if (currentCarrier !== carrier || currentTtn !== orderTtn) {
    return Response.json(
      {
        ok: false,
        message: 'ТТН или перевозчик заказа изменились во время проверки. Выберите актуальную бирку.',
      },
      { status: 409, headers: corsHeaders },
    )
  }

  const recipient = text(user.user_metadata?.labelRecipientEmail).toLowerCase() || defaultRecipient
  if (!validEmail(recipient)) {
    return Response.json(
      { ok: false, message: 'В настройках CRM указан некорректный email для бирок.' },
      { status: 400, headers: corsHeaders },
    )
  }

  const mailText = orderLabelMailText(carrier, orderTtn)
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: resendFromEmail,
      to: [recipient],
      subject: mailText,
      text: mailText,
      attachments: [
        {
          filename: file.name || `${orderTtn}.pdf`,
          content: base64(bytes),
        },
      ],
    }),
  })
  const resendResult = record(await response.json().catch(() => ({})))
  if (!response.ok) {
    return Response.json(
      {
        ok: false,
        message: `Не удалось отправить бирку по email (Resend HTTP ${response.status}).`,
      },
      { status: 502, headers: corsHeaders },
    )
  }

  const sentAt = new Date().toISOString()
  const messageId = text(resendResult.id)
  const { data: latestOrder, error: latestOrderError } = await admin
    .from('crm_orders')
    .select('delivery, updated_at')
    .eq('id', orderId)
    .maybeSingle()
  if (latestOrderError || !latestOrder) {
    return Response.json(
      {
        ok: false,
        emailSent: true,
        message:
          'Письмо отправлено, но CRM не смогла сохранить отметку «Бирка отправлена». Не отправляйте повторно, пока не проверите почту.',
      },
      { status: 500, headers: corsHeaders },
    )
  }

  const latestDelivery = record(latestOrder.delivery)
  const latestCarrier = orderLabelCarrier(latestDelivery.carrier)
  const latestTtn = latestCarrier
    ? canonicalOrderLabelTtn(latestCarrier, latestDelivery.ttn)
    : ''
  if (latestCarrier !== carrier || latestTtn !== orderTtn) {
    return Response.json(
      {
        ok: false,
        emailSent: true,
        message:
          'Письмо отправлено, но ТТН заказа успела измениться. Отметка не сохранена; проверьте почту и актуальный заказ.',
      },
      { status: 409, headers: corsHeaders },
    )
  }

  const { data: savedRows, error: saveError } = await admin
    .from('crm_orders')
    .update({
      delivery: {
        ...latestDelivery,
        labelEmailSentAt: sentAt,
        labelEmailSentTtn: orderTtn,
        labelEmailMessageId: messageId || undefined,
      },
    })
    .eq('id', orderId)
    .eq('updated_at', latestOrder.updated_at)
    .select('id')
  if (saveError || savedRows?.length !== 1) {
    return Response.json(
      {
        ok: false,
        emailSent: true,
        message:
          'Письмо отправлено, но CRM не смогла безопасно сохранить отметку «Бирка отправлена» из-за параллельного изменения заказа. Не отправляйте повторно, пока не проверите почту.',
      },
      { status: 409, headers: corsHeaders },
    )
  }

  return Response.json(
    { ok: true, orderId, ttn: orderTtn, recipient, sentAt, messageId },
    { headers: corsHeaders },
  )
})
