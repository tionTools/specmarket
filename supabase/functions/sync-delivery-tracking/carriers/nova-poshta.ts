import { compactEvents, parseTrackingDate, readableStatus, record, text } from '../normalize.ts'
import type { JsonRecord, RelatedShipment, TrackingDestination, TrackingResult } from '../types.ts'

const novaApiUrl = 'https://api.novaposhta.ua/v2.0/json/'
const redirectTimeoutMs = 6_000

export type NovaRedirectCircuit = { failed: boolean }

function normalizedTtn(value: unknown) {
  return text(value).replace(/\s/g, '')
}

async function novaCall(
  apiKey: string,
  modelName: string,
  calledMethod: string,
  methodProperties: JsonRecord,
  timeoutMs?: number,
) {
  const controller = timeoutMs ? new AbortController() : undefined
  const timeout = timeoutMs ? setTimeout(() => controller?.abort(), timeoutMs) : undefined
  try {
    const response = await fetch(novaApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ apiKey, modelName, calledMethod, methodProperties }),
      signal: controller?.signal,
    })
    if (!response.ok) throw new Error(`Nova Poshta HTTP ${response.status}`)
    const payload = record(await response.json())
    if (payload.success === false) {
      const errors = Array.isArray(payload.errors) ? payload.errors.map(text).filter(Boolean) : []
      throw new Error(`Nova Poshta API ${calledMethod}: ${errors.at(0) || 'неизвестная ошибка'}`)
    }
    return (Array.isArray(payload.data) ? payload.data : []).map(record)
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function novaShipment(apiKey: string, ttn: string, timeoutMs?: number) {
  const rows = await novaCall(apiKey, 'TrackingDocument', 'getStatusDocuments', {
    Documents: [{ DocumentNumber: normalizedTtn(ttn) }],
  }, timeoutMs)
  const shipment = record(rows.at(0))
  if (!Object.keys(shipment).length) throw new Error('Nova Poshta API не вернула отправление')
  return shipment
}

function novaDestination(shipment: JsonRecord): TrackingDestination | undefined {
  const city = text(shipment.CityRecipient)
  const address =
    text(shipment.WarehouseRecipient) ||
    text(shipment.WarehouseRecipientAddress) ||
    text(shipment.RecipientAddress)
  const branchNumber = text(shipment.WarehouseRecipientNumber)
  const locationCode = text(shipment.WarehouseRecipientRef)
  if (!city && !address && !branchNumber && !locationCode) return undefined
  return { city, address, branchNumber, locationCode }
}

function novaDate(value: unknown) {
  const source = text(value)
  const parsed = parseTrackingDate(source)
  if (Number.isFinite(parsed)) return parsed
  const match = source.match(/^(\d{2})-(\d{2})-(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/)
  if (!match) return Number.NEGATIVE_INFINITY
  const [, day, month, year, hour = '0', minute = '0', second = '0'] = match
  return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))
}

async function novaRedirections(apiKey: string, ttn: string) {
  return novaCall(apiKey, 'AdditionalService', 'getRedirectionOrdersList', {
    DocumentNumber: normalizedTtn(ttn),
    Page: '1',
    Limit: '100',
  }, redirectTimeoutMs)
}

function latestRedirection(rows: JsonRecord[], ttn: string) {
  const normalized = normalizedTtn(ttn)
  return rows
    .filter((row) => normalizedTtn(row.DocumentNumber) === normalized)
    .reduce<JsonRecord | undefined>((latest, row) => {
      if (!latest) return row
      return novaDate(row.DateTime) >= novaDate(latest.DateTime) ? row : latest
    }, undefined)
}

export async function novaStatus(ttn: string, redirectCircuit?: NovaRedirectCircuit): Promise<TrackingResult> {
  const apiKey = text(Deno.env.get('NOVA_POSHTA_API_KEY'))
  if (!apiKey) throw new Error('Не задан NOVA_POSHTA_API_KEY')

  let activeTtn = normalizedTtn(ttn)
  let shipment = await novaShipment(apiKey, activeTtn)
  const relatedShipments: RelatedShipment[] = []
  let relation: TrackingResult['relation']
  let redirectLookupError = ''
  const visited = new Set<string>([activeTtn])

  if (redirectCircuit?.failed) {
    redirectLookupError = 'Проверка переадресации Nova Poshta пропущена после ошибки в этом запуске'
  } else {
    try {
      for (let depth = 0; depth < 5; depth += 1) {
        const redirect = latestRedirection(await novaRedirections(apiKey, activeTtn), activeTtn)
        if (!redirect) break
        const redirectedTtn = normalizedTtn(redirect.ExpressWaybillNumber) || activeTtn
        if (redirectedTtn !== activeTtn && !visited.has(redirectedTtn)) {
          const redirectedShipment = await novaShipment(apiKey, redirectedTtn, redirectTimeoutMs)
          relatedShipments.push({
            ttn: redirectedTtn,
            relation: 'redirect',
            relatedTtn: activeTtn,
            destination: {
              city: text(redirect.CityRecipient),
              address: text(redirect.RecipientAddress),
            },
          })
          relation = 'redirect'
          visited.add(redirectedTtn)
          activeTtn = redirectedTtn
          shipment = redirectedShipment
          continue
        }
        if (redirectedTtn === activeTtn) {
          relatedShipments.push({
            ttn: activeTtn,
            relation: 'redirect',
            destination: {
              city: text(redirect.CityRecipient),
              address: text(redirect.RecipientAddress),
            },
          })
          relation = 'redirect'
        }
        break
      }
    } catch (error) {
      redirectLookupError = error instanceof Error ? error.message : 'Ошибка проверки переадресации Nova Poshta'
      if (redirectCircuit) redirectCircuit.failed = true
    }
  }

  const lightReturnNumber = normalizedTtn(shipment.LightReturnNumber)
  if (lightReturnNumber && lightReturnNumber !== activeTtn) {
    relatedShipments.push({ ttn: activeTtn, relation: 'return', relatedTtn: lightReturnNumber })
    relation = relation ?? 'return'
  }

  const source = text(shipment.Status)
  const base = readableStatus(source, text(shipment.StatusCode))
  const eventAt = text(shipment.DateScan) || text(shipment.RecipientDateTime)
  const events = compactEvents([{
    at: eventAt,
    status: source || base.status,
    code: text(shipment.StatusCode),
    location: text(shipment.WarehouseRecipient),
  }])
  return {
    ...base,
    status: source || base.status,
    provider: 'nova_poshta_api',
    source: 'carrier_api',
    activeTtn,
    relation,
    destination: novaDestination(shipment),
    relatedShipments,
    events,
    details: {
      trackingEventAt: eventAt,
      trackingAcceptedAt: text(shipment.DateCreated),
      trackingExpectedDeliveryAt: text(shipment.ScheduledDeliveryDate),
      trackingDeliveredAt: text(shipment.ActualDeliveryDate) || text(shipment.RecipientDateTime),
      trackingLocation: text(shipment.WarehouseRecipient),
      trackingLocationCity: text(shipment.CityRecipient),
      trackingOrigin: text(shipment.WarehouseSender),
      trackingOriginCity: text(shipment.CitySender),
      trackingStatusCode: text(shipment.StatusCode),
      trackingLightReturnNumber: lightReturnNumber,
      trackingRedirectLookupError: redirectLookupError,
    },
  }
}
