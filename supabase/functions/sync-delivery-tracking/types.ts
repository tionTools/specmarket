export type JsonRecord = Record<string, unknown>

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
  details?: JsonRecord
}

export type CarrierKind = 'meest' | 'nova' | 'rozetka' | 'ukrposhta' | ''

export type WorkerResult = {
  status?: number
  body: JsonRecord
}
