import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { record } from './normalize.ts'
import { runTrackingWorker } from './worker.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const body = record(await request.json().catch(() => ({})))
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const authorization = request.headers.get('Authorization')
  if (!url || !anonKey || !serviceKey || !authorization) return Response.json({ ok: false, message: 'Не хватает настроек функции.' }, { status: 500, headers: corsHeaders })

  const admin = createClient(url, serviceKey)
  const { data: cronSecret } = await admin.rpc('get_crm_sync_cron_secret')
  const scheduled = typeof cronSecret === 'string' && authorization === `Bearer ${cronSecret}`
  const auth = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } })
  const { data: { user } } = scheduled ? { data: { user: null } } : await auth.auth.getUser()
  if (!scheduled && !user) return Response.json({ ok: false, message: 'Нужен вход в CRM.' }, { status: 401, headers: corsHeaders })
  if (!scheduled && user?.email?.toLowerCase() === 'guest@gmail.com') return Response.json({ ok: false, message: 'Гостевой аккаунт не может запускать синхронизацию.' }, { status: 403, headers: corsHeaders })
  const forced = body.force === true && !scheduled && Boolean(user)
  const result = await runTrackingWorker(admin, forced)
  return Response.json(result.body, { ...(result.status ? { status: result.status } : {}), headers: corsHeaders })
})
