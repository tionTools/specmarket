import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { carrierKind } from './carrier-detection.ts'
import { meestStatus } from './carriers/meest.ts'
import { novaStatus, type NovaRedirectCircuit } from './carriers/nova-poshta.ts'
import { rozetkaStatus } from './carriers/rozetka-delivery.ts'
import { ukrposhtaStatus } from './carriers/ukrposhta.ts'
import { isFinal, record, text } from './normalize.ts'
import { mergeTrackingDelivery, sameShipment, trackingChanged } from './storage.ts'
import type { CarrierKind, JsonRecord, TrackingResult, WorkerResult } from './types.ts'

const finalOrderStatuses = '(Виконано,Закрыт,Закрито,Скасовано,Возврат,MoneyRefundSuccess,canceled,completed,delivered)'

type TrackingOrderRow = { id: string; external_id: unknown; delivery: unknown }
type TrackingStateRow = { order_id: string; last_checked_at: unknown }

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

function hasActiveTracking(delivery: JsonRecord) {
  const normalizedStatus = text(delivery.trackingNormalizedStatus)
  return Boolean(normalizedStatus) && !['delivered', 'returned', 'cancelled'].includes(normalizedStatus)
}

function isDue(delivery: JsonRecord, lastCheckedAt: unknown, minutes: number, now: number) {
  if (
    !minutes ||
    !text(delivery.ttn) ||
    (!hasActiveTracking(delivery) && (isFinal(text(delivery.trackingStatus)) || isFinal(text(delivery.status))))
  )
    return false
  const checked = Date.parse(text(lastCheckedAt))
  return !Number.isFinite(checked) || now - checked >= minutes * 60_000
}

async function getTrackingStatus(delivery: JsonRecord, novaRedirectCircuit: NovaRedirectCircuit): Promise<TrackingResult> {
  const ttn = text(delivery.ttn)
  switch (carrierKind(delivery)) {
    case 'nova': return novaStatus(ttn, novaRedirectCircuit)
    case 'meest': return meestStatus(ttn)
    case 'rozetka': return rozetkaStatus(ttn)
    case 'ukrposhta': return ukrposhtaStatus(ttn)
    default: throw new Error('Неподдерживаемый перевозчик')
  }
}

export async function runTrackingWorker(admin: SupabaseClient, forced: boolean): Promise<WorkerResult> {
  const minutes = intervalMinutes()
  if (!forced && !minutes) return { body: { ok: true, skipped: 'night', checked: 0, updated: 0 } }

  const now = new Date()
  const { data: rows, error } = await admin.from('crm_orders')
    .select('id, external_id, delivery')
    .or(`status.not.in.${finalOrderStatuses},and(delivery->>trackingNormalizedStatus.not.is.null,delivery->>trackingNormalizedStatus.not.in.(delivered,returned,cancelled))`)
    .not('delivery->>ttn', 'is', null)
  if (error) return { status: 500, body: { ok: false, message: error.message } }
  const orderRows = (rows ?? []) as TrackingOrderRow[]
  const ids = orderRows.map((row) => row.id)
  const { data: states, error: statesError } = ids.length
    ? await admin.from('crm_delivery_tracking_state').select('order_id, last_checked_at').in('order_id', ids)
    : { data: [], error: null }
  if (statesError) return { status: 500, body: { ok: false, message: statesError.message } }
  const trackingStates = (states ?? []) as TrackingStateRow[]
  const stateByOrder = new Map(trackingStates.map((state) => [state.order_id, state]))
  let checked = 0
  let updated = 0
  let failed = 0
  const novaRedirectCircuit: NovaRedirectCircuit = { failed: false }
  for (const row of orderRows) {
    const delivery = record(row.delivery)
    const carrier: CarrierKind = carrierKind(delivery)
    const trackable = Boolean(text(delivery.ttn)) && (hasActiveTracking(delivery) || (!isFinal(text(delivery.trackingStatus)) && !isFinal(text(delivery.status))))
    if (!carrier || (!forced && !isDue(delivery, stateByOrder.get(row.id)?.last_checked_at, minutes, now.getTime())) || (forced && !trackable)) continue
    try {
      const result = await getTrackingStatus(delivery, novaRedirectCircuit)
      const { data: currentRow, error: currentError } = await admin.from('crm_orders').select('delivery').eq('id', row.id).maybeSingle()
      if (currentError) throw currentError
      const currentDelivery = record(currentRow?.delivery)
      if (!sameShipment(delivery, currentDelivery)) continue
      const changed = trackingChanged(currentDelivery, result)
      const state = { order_id: row.id, last_checked_at: now.toISOString(), last_error: null, provider: result.provider ?? carrier, details: result.details ?? null, updated_at: now.toISOString() }
      const { error: stateError } = await admin.from('crm_delivery_tracking_state').upsert(state)
      if (stateError) throw stateError
      checked += 1
      if (!changed) continue
      const nextDelivery = mergeTrackingDelivery(
        currentDelivery,
        result,
        now.toISOString(),
        text(row.external_id) ? 'marketplace' : 'manual',
      )
      const { error: updateError } = await admin.from('crm_orders').update({ delivery: nextDelivery }).eq('id', row.id)
      if (updateError) throw updateError
      updated += 1
    } catch (error) {
      failed += 1
      console.error(`Tracking ${text(delivery.ttn)}:`, error)
      const { data: currentRow, error: currentError } = await admin.from('crm_orders').select('delivery').eq('id', row.id).maybeSingle()
      if (currentError) {
        console.error(`Tracking ${text(delivery.ttn)}:`, currentError)
        continue
      }
      const currentDelivery = record(currentRow?.delivery)
      if (!sameShipment(delivery, currentDelivery)) continue
      await admin.from('crm_delivery_tracking_state').upsert({
        order_id: row.id, last_checked_at: now.toISOString(), last_error: error instanceof Error ? error.message : 'Ошибка tracking', provider: carrier || null, updated_at: now.toISOString(),
      })
    }
  }
  return { body: { ok: true, ...(forced ? { forced: true } : { intervalMinutes: minutes }), checked, updated, failed } }
}
