import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { displayedUsdSale } from './parse.ts'

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers })
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers })

  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) return Response.json({ error: 'Требуется вход в CRM.' }, { status: 401, headers })
  const url = Deno.env.get('SUPABASE_URL')
  const publishableKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !publishableKey || !serviceKey) return Response.json({ error: 'Сервис курса не настроен.' }, { status: 500, headers })
  const client = createClient(url, publishableKey)
  const { data: { user }, error: authError } = await client.auth.getUser(authorization.slice(7))
  if (authError || !user || user.email?.toLowerCase() === 'guest@gmail.com')
    return Response.json({ error: 'Нет доступа к обновлению курса.' }, { status: 403, headers })

  const requestedAt = new Date().toISOString()
  try {
    const response = await fetch('https://kyt-obmin.kh.ua/ru/usd-uah', { signal: AbortSignal.timeout(10000) })
    if (!response.ok) throw new Error(`Сайт КИТ Обмін вернул HTTP ${response.status}.`)
    const html = await response.text()
    if (html.length > 2_000_000) throw new Error('Страница КИТ Обмін слишком большая.')
    const rate = displayedUsdSale(html)
    const admin = createClient(url, serviceKey)
    const { data, error } = await admin.rpc('save_crm_kyt_usd_rate', { p_rate: rate, p_requested_at: requestedAt })
    if (error || !data) throw new Error('Не удалось сохранить курс в CRM.')
    return Response.json({ rate: Number(data.sell_rate), fetchedAt: data.fetched_at }, { headers })
  } catch (error) {
    const message = error instanceof Error && error.name === 'TimeoutError'
      ? 'Сайт КИТ Обмін не ответил вовремя.'
      : error instanceof Error ? error.message : 'Не удалось обновить курс.'
    return Response.json({ error: message }, { status: 502, headers })
  }
})
