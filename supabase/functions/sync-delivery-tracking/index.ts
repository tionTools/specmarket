import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type JsonRecord = Record<string, unknown>
type TrackingResult = { status: string; final: boolean }

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : value === null || value === undefined ? '' : String(value).trim()
}

function currentKyiv() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date())
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  return { hour: value('hour'), minute: value('minute') }
}

function intervalMinutes() {
  const { hour } = currentKyiv()
  if (hour < 7) return 0
  return hour < 21 ? 30 : 60
}

function isFinal(status: string) {
  return /(отримано|получено|доставлено|вручено|завершено|повернено|возвращено|скасовано|отменено|відмінен|cancel|return|received|delivered)/i.test(status)
}

function isDue(delivery: JsonRecord, minutes: number, now: number) {
  if (!minutes || !text(delivery.ttn) || isFinal(text(delivery.trackingStatus)) || isFinal(text(delivery.status))) return false
  const checked = Date.parse(text(delivery.trackingLastCheckedAt))
  return !Number.isFinite(checked) || now - checked >= minutes * 60_000
}

function carrierKind(delivery: JsonRecord) {
  const carrier = text(delivery.carrier).toLowerCase()
  const ttn = text(delivery.ttn).replace(/\s/g, '')
  if (/^722-\d+$/.test(ttn) || carrier.includes('meest') || carrier.includes('міст') || carrier.includes('cvz_epicentr') || carrier.includes('parcel_box_epicentr')) return 'meest'
  if (carrier.includes('nova') || carrier.includes('нова') || carrier.includes('novaposhta')) return 'nova'
  if (carrier.includes('rozetka')) return 'rozetka'
  if (carrier.includes('ukr') || carrier.includes('укр')) return 'ukrposhta'
  return ''
}

function readableStatus(source: string): TrackingResult {
  const value = source.trim()
  const normalized = value.toLowerCase()
  if (/receivedwarehouse|received|отриман|получен|вручено|доставлено/.test(normalized)) return { status: 'Получено', final: true }
  if (/return|повернен/.test(normalized)) return { status: 'Возвращено', final: true }
  if (/cancel|скасован|відмінен/.test(normalized)) return { status: 'Отменено', final: true }
  if (/arriv.*recipient|прибул.*відділен|готов.*видач|arrived/.test(normalized)) return { status: 'Готово к выдаче', final: false }
  if (/createid|оформив|заплан/.test(normalized)) return { status: 'Запланировано', final: false }
  if (/warehouse|прийнял|принят/.test(normalized)) return { status: 'Принято перевозчиком', final: false }
  if (/way|route|виїхал|виїхала|руха|пряму/.test(normalized)) return { status: 'На пути к получателю', final: false }
  return { status: value || 'Запланировано', final: isFinal(value) }
}

async function novaStatus(ttn: string): Promise<TrackingResult> {
  const response = await fetch(`https://api.novapost.com/site/v.1.0/shipments/tracking/${encodeURIComponent(ttn.replace(/\s/g, ''))}`, {
    headers: { 'Accept-Language': 'uk' },
  })
  if (!response.ok) throw new Error(`Nova Poshta HTTP ${response.status}`)
  const data = record(await response.json())
  const events = Array.isArray(data.tracking) ? data.tracking.map(record) : []
  const latest = events.find((item) => text(item.event_status).toLowerCase() === 'now') ?? events.at(-1)
  if (!latest) throw new Error('Nova Poshta не вернула статус')
  const base = readableStatus(`${text(latest.event)} ${text(latest.event_name)} ${text(latest.code)}`)
  return base
}

async function meestStatus(ttn: string): Promise<TrackingResult> {
  const url = new URL('https://t.meest-group.com/get.php')
  url.searchParams.set('what', 'tracking_info_n')
  url.searchParams.set('out', 'json')
  url.searchParams.set('lang', 'uk')
  url.searchParams.set('number', ttn)
  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`Meest HTTP ${response.status}`)
  const data = record(await response.json())
  const source = text(data.condition) || text(data.status) || text(data.status_name) || text(data.state)
  if (!source) throw new Error('Meest не вернул публичный статус')
  return readableStatus(source)
}

async function rozetkaStatus(ttn: string): Promise<TrackingResult> {
  // Это публичный XHR самого сайта Rozetka Delivery. Если сервис временно закрывает
  // ответ, ошибка обрабатывается только для одной доставки и не затрагивает остальные.
  const url = new URL('https://rz-delivery.rozetka.ua/api/track/status')
  url.searchParams.set('parcel_id', ttn)
  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`Rozetka Delivery HTTP ${response.status}`)
  const data = record(await response.json())
  const source = text(data.status_name) || text(data.status) || text(data.state) || text(record(data.parcel).status)
  if (!source) throw new Error('Rozetka Delivery не вернул публичный статус')
  return readableStatus(source)
}

async function ukrposhtaStatus(ttn: string): Promise<TrackingResult> {
  // Укрпочта оставляет публичную страницу трекинга, но может включать антибот-защиту.
  // Пробуем её публичный HTTP-маршрут; при защите не меняем сохранённый статус.
  const url = new URL('https://www.ukrposhta.ua/status-tracking/0.0.1/status')
  url.searchParams.set('barcode', ttn.replace(/\s/g, ''))
  const response = await fetch(url, { headers: { Accept: 'application/json, text/plain, */*' } })
  if (!response.ok) throw new Error(`Укрпочта HTTP ${response.status}`)
  const data = record(await response.json())
  const events = Array.isArray(data.items) ? data.items.map(record) : Array.isArray(data.events) ? data.events.map(record) : []
  const latest = events.at(-1) ?? data
  const source = text(latest.status) || text(latest.statusName) || text(latest.name) || text(data.status)
  if (!source) throw new Error('Укрпочта не вернула публичный статус')
  return readableStatus(source)
}

async function getTrackingStatus(delivery: JsonRecord) {
  const ttn = text(delivery.ttn)
  switch (carrierKind(delivery)) {
    case 'nova': return novaStatus(ttn)
    case 'meest': return meestStatus(ttn)
    case 'rozetka': return rozetkaStatus(ttn)
    case 'ukrposhta': return ukrposhtaStatus(ttn)
    default: throw new Error('Неподдерживаемый перевозчик')
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const authorization = request.headers.get('Authorization')
  if (!url || !anonKey || !serviceKey || !authorization) return Response.json({ ok: false, message: 'Не хватает настроек функции.' }, { status: 500, headers: corsHeaders })

  const admin = createClient(url, serviceKey)
  const { data: cronSecret } = await admin.rpc('get_crm_sync_cron_secret')
  const scheduled = typeof cronSecret === 'string' && authorization === `Bearer ${cronSecret}`
  const auth = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } })
  const { data: { user } } = await auth.auth.getUser()
  if (!scheduled && !user) return Response.json({ ok: false, message: 'Нужен вход в CRM.' }, { status: 401, headers: corsHeaders })
  if (!scheduled && user?.email?.toLowerCase() === 'guest@gmail.com') return Response.json({ ok: false, message: 'Гостевой аккаунт не может запускать синхронизацию.' }, { status: 403, headers: corsHeaders })

  const minutes = intervalMinutes()
  if (!minutes) return Response.json({ ok: true, skipped: 'night', checked: 0, updated: 0 }, { headers: corsHeaders })

  const now = new Date()
  const { data: rows, error } = await admin.from('crm_orders').select('id, delivery').limit(1000)
  if (error) return Response.json({ ok: false, message: error.message }, { status: 500, headers: corsHeaders })
  let checked = 0
  let updated = 0
  let failed = 0
  for (const row of rows ?? []) {
    const delivery = record(row.delivery)
    if (!carrierKind(delivery) || !isDue(delivery, minutes, now.getTime())) continue
    try {
      const result = await getTrackingStatus(delivery)
      const changed = result.status !== text(delivery.trackingStatus)
      const nextDelivery: JsonRecord = {
        ...delivery,
        trackingStatus: result.status,
        trackingLastCheckedAt: now.toISOString(),
        trackingLastError: '',
      }
      if (changed) nextDelivery.trackingStatusChangedAt = now.toISOString()
      const { error: updateError } = await admin.from('crm_orders').update({ delivery: nextDelivery }).eq('id', row.id)
      if (updateError) throw updateError
      checked += 1
      if (changed) updated += 1
    } catch (error) {
      failed += 1
      console.error(`Tracking ${text(delivery.ttn)}:`, error)
      await admin.from('crm_orders').update({ delivery: { ...delivery, trackingLastError: error instanceof Error ? error.message : 'Ошибка tracking' } }).eq('id', row.id)
    }
  }
  return Response.json({ ok: true, checked, updated, failed, intervalMinutes: minutes }, { headers: corsHeaders })
})
