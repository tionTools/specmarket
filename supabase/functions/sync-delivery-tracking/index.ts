import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const finalOrderStatuses = '(Виконано,Закрыт,Закрито,Скасовано,Возврат,MoneyRefundSuccess,canceled,completed,delivered)'

type JsonRecord = Record<string, unknown>
type TrackingEvent = {
  at?: string
  status?: string
  code?: string
  location?: string
  locationCode?: string
  country?: string
}
type TrackingResult = {
  status: string
  final: boolean
  normalizedStatus: string
  provider?: string
  details?: JsonRecord
}

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

function hasActiveTracking(delivery: JsonRecord) {
  const normalizedStatus = text(delivery.trackingNormalizedStatus)
  return Boolean(normalizedStatus) && !['delivered', 'returned', 'cancelled'].includes(normalizedStatus)
}

function isDue(delivery: JsonRecord, minutes: number, now: number) {
  if (
    !minutes ||
    !text(delivery.ttn) ||
    (!hasActiveTracking(delivery) && (isFinal(text(delivery.trackingStatus)) || isFinal(text(delivery.status))))
  )
    return false
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

function readableStatus(source: string, code = ''): TrackingResult {
  const value = source.trim()
  const normalized = `${value} ${code}`.toLowerCase()
  if (/return|повернен|41010|31200/.test(normalized)) return { status: 'Возвращено', final: true, normalizedStatus: 'returned' }
  if (/cancel|скасован|відмінен|10600|10602|102|103/.test(normalized)) return { status: 'Отменено', final: true, normalizedStatus: 'cancelled' }
  if (/receivedwarehouse|received|отриман|получен|вручено|доставлено|41000|\b9\b|\b10\b|\b11\b/.test(normalized)) return { status: 'Получено', final: true, normalizedStatus: 'delivered' }
  if (/arriv.*recipient|прибул.*відділен|готов.*видач|arrived|21700|\b7\b|\b8\b/.test(normalized)) return { status: 'Готово к выдаче', final: false, normalizedStatus: 'ready_for_pickup' }
  if (/createid|оформив|заплан|10100|\b1\b/.test(normalized)) return { status: 'Запланировано', final: false, normalizedStatus: 'created' }
  if (/warehouse|прийнял|принят|accept|registered/.test(normalized)) return { status: 'Принято перевозчиком', final: false, normalizedStatus: 'accepted' }
  if (/way|route|виїхал|виїхала|руха|пряму|відправлен|deliver|20700|20800|20900|21500|101/.test(normalized)) return { status: 'На пути к получателю', final: false, normalizedStatus: 'in_transit' }
  return { status: value || 'Запланировано', final: isFinal(value), normalizedStatus: 'unknown' }
}

function compactEvents(events: TrackingEvent[]) {
  return events.filter((event) => Object.values(event).some(Boolean)).slice(-30)
}

function parseTrackingDate(value: unknown) {
  const source = text(value)
  const match = source.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/)
  if (match) {
    const [, year, month, day, hour = '0', minute = '0', second = '0'] = match
    return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))
  }
  const ukrainianMatch = source.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/)
  if (ukrainianMatch) {
    const [, day, month, year, hour = '0', minute = '0', second = '0'] = ukrainianMatch
    return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))
  }
  return Number.NEGATIVE_INFINITY
}

function latestEvent(events: JsonRecord[], dateField: string) {
  return events.reduce<JsonRecord>((current, event) =>
    parseTrackingDate(event[dateField]) > parseTrackingDate(current[dateField]) ? event : current,
  record(events[0]))
}

function meestReadableStatus(source: string, code: string) {
  if (code === '2') return { status: 'Создана накладная', final: false, normalizedStatus: 'created' }
  return readableStatus(source, code)
}

function ukrposhtaReadableStatus(source: string, code: string, reason: string) {
  if (code === '10100') return { status: 'Принято перевозчиком', final: false, normalizedStatus: 'accepted' }
  if (code === '31200') return { status: 'Возвращается отправителю', final: false, normalizedStatus: 'returning' }
  if (code === '41000' && reason === '10') return { status: 'Возвращено', final: true, normalizedStatus: 'returned' }
  if (code === '41000' || code === '48000') return { status: 'Получено', final: true, normalizedStatus: 'delivered' }
  return readableStatus(source, code)
}

async function novaStatus(ttn: string): Promise<TrackingResult> {
  const apiKey = text(Deno.env.get('NOVA_POSHTA_API_KEY'))
  if (!apiKey) throw new Error('Не задан NOVA_POSHTA_API_KEY')
  const response = await fetch('https://api.novaposhta.ua/v2.0/json/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      apiKey,
      modelName: 'TrackingDocument',
      calledMethod: 'getStatusDocuments',
      methodProperties: { Documents: [{ DocumentNumber: ttn.replace(/\s/g, '') }] },
    }),
  })
  if (!response.ok) throw new Error(`Nova Poshta HTTP ${response.status}`)
  const data = record(await response.json())
  if (data.success === false) throw new Error(`Nova Poshta API: ${text((Array.isArray(data.errors) ? data.errors : []).at(0)) || 'неизвестная ошибка'}`)
  const shipment = record((Array.isArray(data.data) ? data.data : []).at(0))
  if (!Object.keys(shipment).length) throw new Error('Nova Poshta API не вернула отправление')
  const base = readableStatus(text(shipment.Status), text(shipment.StatusCode))
  return {
    ...base,
    provider: 'nova_poshta_api',
    details: {
      trackingEventAt: text(shipment.DateScan) || text(shipment.RecipientDateTime),
      trackingAcceptedAt: text(shipment.DateCreated),
      trackingExpectedDeliveryAt: text(shipment.ScheduledDeliveryDate),
      trackingDeliveredAt: text(shipment.ActualDeliveryDate) || text(shipment.RecipientDateTime),
      trackingLocation: text(shipment.WarehouseRecipient),
      trackingLocationCity: text(shipment.CityRecipient),
      trackingOrigin: text(shipment.WarehouseSender),
      trackingOriginCity: text(shipment.CitySender),
      trackingStatusCode: text(shipment.StatusCode),
    },
  }
}

async function meestStatus(ttn: string): Promise<TrackingResult> {
  const apiToken = text(Deno.env.get('MEEST_API_TOKEN'))
  if (!apiToken) throw new Error('Не задан MEEST_API_TOKEN')
  const trackNumber = encodeURIComponent(ttn.replace(/\s/g, ''))
  const response = await fetch(`https://api.meest.com/v3.0/openAPI/tracking/${trackNumber}`, {
    headers: { Accept: 'application/json', token: apiToken },
  })
  if (!response.ok) throw new Error(`Meest HTTP ${response.status}`)
  const raw = record(await response.json())
  const events = (Array.isArray(raw.result) ? raw.result : []).map(record)
  const latest = latestEvent(events, 'eventDateTime')
  const source = text(record(latest?.eventDescr).descrUA) || text(latest?.eventDescr) || text(raw.status)
  if (!source) throw new Error('Meest API не вернул статус')
  const eventCode = text(latest?.eventCode)
  const base = meestReadableStatus(source, eventCode)
  const final = /^(1622|1825|3|5700)$/.test(eventCode) || base.final
  const trackingEvents = compactEvents(events.map((event) => ({
    at: text(event.eventDateTime),
    status: text(record(event.eventDescr).descrUA) || text(event.eventDescr),
    code: text(event.eventCode),
    location: text(record(event.eventCityDescr).descrUA),
    country: text(record(event.eventCountryDescr).descrUA),
  })))
  return {
    ...base,
    final,
    provider: 'meest_api',
    details: {
      trackingEventAt: text(latest?.eventDateTime),
      trackingLocation: text(record(latest?.eventCityDescr).descrUA),
      trackingLocationCountry: text(record(latest?.eventCountryDescr).descrUA),
      trackingLocationDetails: text(record(latest?.eventDetailDescr).descrUA),
      trackingStatusCode: eventCode,
      trackingDeliveredAt: eventCode === '1622' ? text(latest?.eventDateTime) : '',
      trackingEvents,
    },
  }
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
  const statusBearer = text(Deno.env.get('UKRPOSHTA_STATUS_BEARER'))
  if (!statusBearer) throw new Error('Не задан UKRPOSHTA_STATUS_BEARER')
  const url = new URL('https://www.ukrposhta.ua/status-tracking/0.0.1/statuses')
  url.searchParams.set('barcode', ttn.replace(/\s/g, ''))
  const response = await fetch(url, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${statusBearer}` },
  })
  if (!response.ok) throw new Error(`Укрпочта HTTP ${response.status}`)
  const data = await response.json()
  const events = (Array.isArray(data) ? data : []).map(record)
  const latest = latestEvent(events, 'date')
  if (!latest) throw new Error('Укрпочта API не вернула статусы')
  const eventCode = text(latest.event)
  const eventReason = text(latest.eventReason_id)
  const source = text(latest.eventName) || text(latest.status) || text(latest.name)
  const base = ukrposhtaReadableStatus(source, eventCode, eventReason)
  const deliveredAt = (eventCode === '48000' || (eventCode === '41000' && eventReason !== '10'))
    ? text(latest.date)
    : ''
  return {
    ...base,
    provider: 'ukrposhta_status_api',
    details: {
      trackingEventAt: text(latest.date),
      trackingLocation: text(latest.name),
      trackingLocationCode: text(latest.index),
      trackingLocationCountry: text(latest.country),
      trackingStatusCode: eventCode,
      trackingDeliveredAt: deliveredAt,
      trackingEvents: compactEvents(events.map((event) => ({
        at: text(event.date),
        status: text(event.eventName),
        code: text(event.event),
        location: text(event.name),
        locationCode: text(event.index),
        country: text(event.country),
      }))),
    },
  }
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
  const { data: { user } } = await auth.auth.getUser()
  if (!scheduled && !user) return Response.json({ ok: false, message: 'Нужен вход в CRM.' }, { status: 401, headers: corsHeaders })
  if (!scheduled && user?.email?.toLowerCase() === 'guest@gmail.com') return Response.json({ ok: false, message: 'Гостевой аккаунт не может запускать синхронизацию.' }, { status: 403, headers: corsHeaders })
  const forced = body.force === true && !scheduled && Boolean(user)
  const minutes = intervalMinutes()
  if (!forced && !minutes) return Response.json({ ok: true, skipped: 'night', checked: 0, updated: 0 }, { headers: corsHeaders })

  const now = new Date()
  const { data: rows, error } = await admin.from('crm_orders')
    .select('id, delivery')
    .or(`status.not.in.${finalOrderStatuses},and(delivery->>trackingNormalizedStatus.not.is.null,delivery->>trackingNormalizedStatus.not.in.(delivered,returned,cancelled))`)
    .not('delivery->>ttn', 'is', null)
  if (error) return Response.json({ ok: false, message: error.message }, { status: 500, headers: corsHeaders })
  let checked = 0
  let updated = 0
  let failed = 0
  for (const row of rows ?? []) {
    const delivery = record(row.delivery)
    const carrier = carrierKind(delivery)
    const trackable = Boolean(text(delivery.ttn)) && (hasActiveTracking(delivery) || (!isFinal(text(delivery.trackingStatus)) && !isFinal(text(delivery.status))))
    if (!carrier || carrier === 'rozetka' || (!forced && !isDue(delivery, minutes, now.getTime())) || (forced && !trackable)) continue
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
      if (result.provider && result.details) {
        Object.assign(nextDelivery, {
          ...result.details,
          trackingProvider: result.provider,
          trackingSource: 'official_api',
          trackingNormalizedStatus: result.normalizedStatus,
        })
      }
      const { error: updateError } = await admin.from('crm_orders').update({ delivery: nextDelivery }).eq('id', row.id)
      if (updateError) throw updateError
      checked += 1
      if (changed) updated += 1
    } catch (error) {
      failed += 1
      console.error(`Tracking ${text(delivery.ttn)}:`, error)
      await admin.from('crm_orders').update({
        delivery: {
          ...delivery,
          trackingLastCheckedAt: now.toISOString(),
          trackingLastError: error instanceof Error ? error.message : 'Ошибка tracking',
        },
      }).eq('id', row.id)
    }
  }
  return Response.json({ ok: true, ...(forced ? { forced: true } : { intervalMinutes: minutes }), checked, updated, failed }, { headers: corsHeaders })
})
