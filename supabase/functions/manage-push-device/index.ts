import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return Response.json({ ok: false, message: 'Method not allowed.' }, { status: 405, headers: corsHeaders })

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const authorization = request.headers.get('Authorization')
  if (!url || !anonKey || !serviceKey || !authorization) {
    return Response.json({ ok: false, message: 'Push configuration is incomplete.' }, { status: 500, headers: corsHeaders })
  }

  const auth = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } })
  const { data: { user } } = await auth.auth.getUser()
  if (!user || user.email?.toLowerCase() === 'guest@gmail.com') {
    return Response.json({ ok: false, message: 'Unauthorized.' }, { status: 401, headers: corsHeaders })
  }

  const body = await request.json().catch(() => ({})) as { deviceId?: unknown; token?: unknown; enabled?: unknown }
  const deviceId = text(body.deviceId)
  const token = text(body.token)
  const enabled = body.enabled === true
  if (!deviceId || deviceId.length > 200) {
    return Response.json({ ok: false, message: 'Invalid deviceId.' }, { status: 400, headers: corsHeaders })
  }

  const admin = createClient(url, serviceKey)
  if (!enabled) {
    const { error } = await admin.from('crm_push_devices').delete().eq('user_id', user.id).eq('device_id', deviceId)
    if (error) return Response.json({ ok: false, message: error.message }, { status: 500, headers: corsHeaders })
    return Response.json({ ok: true }, { headers: corsHeaders })
  }
  if (!token || token.length > 4096) {
    return Response.json({ ok: false, message: 'Invalid FCM token.' }, { status: 400, headers: corsHeaders })
  }

  const { error } = await admin.from('crm_push_devices').upsert({
    user_id: user.id,
    device_id: deviceId,
    fcm_token: token,
    enabled: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,device_id' })
  if (error) return Response.json({ ok: false, message: error.message }, { status: 500, headers: corsHeaders })
  return Response.json({ ok: true }, { headers: corsHeaders })
})
