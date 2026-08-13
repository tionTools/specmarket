import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type PrintUpdate = {
  orderId: string
  printCheckedAt?: string | null
  printedAt?: string | null
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const authorization = request.headers.get('Authorization')
  if (!url || !anonKey || !serviceKey || !authorization)
    return Response.json({ ok: false, message: 'Не хватает настроек сохранения.' }, { status: 500, headers: corsHeaders })

  const auth = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } })
  const { data: { user } } = await auth.auth.getUser()
  if (!user || user.email?.toLowerCase() === 'guest@gmail.com')
    return Response.json({ ok: false, message: 'Нет прав на изменение заказов.' }, { status: 403, headers: corsHeaders })

  const body = await request.json().catch(() => ({})) as { updates?: PrintUpdate[] }
  const updates = Array.isArray(body.updates) ? body.updates : []
  if (!updates.length)
    return Response.json({ ok: false, message: 'Не переданы заказы.' }, { status: 400, headers: corsHeaders })

  const admin = createClient(url, serviceKey)
  for (const update of updates) {
    const { data: order, error: readError } = await admin
      .from('crm_orders')
      .select('delivery')
      .eq('id', update.orderId)
      .maybeSingle()
    if (readError || !order)
      return Response.json({ ok: false, message: readError?.message ?? 'Заказ не найден.' }, { status: 500, headers: corsHeaders })

    const currentDelivery = order.delivery && typeof order.delivery === 'object' ? order.delivery : {}
    const delivery = { ...currentDelivery } as Record<string, unknown>
    if ('printCheckedAt' in update) {
      if (update.printCheckedAt) delivery.printCheckedAt = update.printCheckedAt
      else delete delivery.printCheckedAt
    }
    if ('printedAt' in update) {
      if (update.printedAt) delivery.printedAt = update.printedAt
      else delete delivery.printedAt
    }
    const { error: updateError } = await admin.from('crm_orders').update({ delivery }).eq('id', update.orderId)
    if (updateError)
      return Response.json({ ok: false, message: updateError.message }, { status: 500, headers: corsHeaders })
  }

  return Response.json({ ok: true, updated: updates.length }, { headers: corsHeaders })
})
