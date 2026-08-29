export type JsonRecord = Record<string, unknown>

export type ShipmentRelation = 'original' | 'redirect' | 'return' | 'replacement' | 'unknown'
export type ShipmentSource = 'marketplace' | 'carrier_api' | 'public_tracking' | 'manual'

export type TrackingDestination = {
  city?: string
  address?: string
  branchNumber?: string
  locationCode?: string
  postalCode?: string
}

export type RelatedShipment = {
  ttn: string
  relation: Exclude<ShipmentRelation, 'original'>
  relatedTtn?: string
  destination?: TrackingDestination
}

export type TrackingEvent = {
  at?: string
  status?: string
  code?: string
  location?: string
  locationCode?: string
  country?: string
}

export type TrackingResult = {
  status: string
  final: boolean
  normalizedStatus: string
  provider?: string
  source?: Extract<ShipmentSource, 'carrier_api' | 'public_tracking'>
  destination?: TrackingDestination
  activeTtn?: string
  relation?: Exclude<ShipmentRelation, 'original'>
  relatedShipments?: RelatedShipment[]
  events?: TrackingEvent[]
  details?: JsonRecord
}

export type CarrierKind = 'meest' | 'nova' | 'rozetka' | 'ukrposhta' | ''

export type WorkerResult = {
  status?: number
  body: JsonRecord
}
