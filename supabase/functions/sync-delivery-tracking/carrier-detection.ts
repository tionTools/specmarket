import type { CarrierKind, JsonRecord } from './types.ts'
import { text } from './normalize.ts'

export function carrierKind(delivery: JsonRecord): CarrierKind {
  const carrier = text(delivery.carrier).toLowerCase()
  const ttn = text(delivery.ttn).replace(/\s/g, '')
  if (/^722-\d+$/.test(ttn) || carrier.includes('meest') || carrier.includes('міст') || carrier.includes('cvz_epicentr') || carrier.includes('parcel_box_epicentr')) return 'meest'
  if (carrier.includes('nova') || carrier.includes('нова') || carrier.includes('novaposhta')) return 'nova'
  if (carrier.includes('rozetka')) return 'rozetka'
  if (carrier.includes('ukr') || carrier.includes('укр')) return 'ukrposhta'
  return ''
}
