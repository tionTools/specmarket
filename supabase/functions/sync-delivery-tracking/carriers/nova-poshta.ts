import { readableStatus, record, text } from '../normalize.ts'
import type { TrackingResult } from '../types.ts'

export async function novaStatus(ttn: string): Promise<TrackingResult> {
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
  const source = text(shipment.Status)
  const base = readableStatus(source, text(shipment.StatusCode))
  return {
    ...base,
    status: source || base.status,
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
