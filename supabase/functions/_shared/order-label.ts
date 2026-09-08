export type OrderLabelCarrier = 'rozetka' | 'meest'

export function orderLabelCarrier(carrier: unknown): OrderLabelCarrier | null {
  const value = String(carrier ?? '').trim().toLowerCase()
  const normalized = value.replace(/[\s-]+/g, '_')
  if (value.includes('rozetka') || normalized === 'rozetka_delivery') return 'rozetka'
  if (
    value.includes('meest') ||
    value.includes('міст') ||
    /^(?:cvz|pickup_point|collection_point)_epicent(?:e)?r$/.test(normalized) ||
    normalized === 'parcel_box_epicentr' ||
    normalized === 'meest_epicentr_postomat' ||
    normalized === 'meest_epicentr_parcel_box'
  )
    return 'meest'
  return null
}

export function canonicalOrderLabelTtn(carrier: OrderLabelCarrier, value: unknown) {
  const source = String(value ?? '').trim().replace(/\s+/g, '')
  if (carrier === 'rozetka') {
    const normalized = source.toUpperCase()
    const digits = normalized.match(/^PRM-?(\d{6,12})$/)?.[1]
    return digits ? `PRM-${digits}` : normalized
  }
  const digits = source.replace(/\D/g, '')
  return digits.length === 10 ? `${digits.slice(0, 3)}-${digits.slice(3)}` : source
}

export function orderLabelTtns(carrier: OrderLabelCarrier, text: string) {
  const matches =
    carrier === 'rozetka'
      ? text.match(/(?:^|[^A-Z0-9])(PRM-\d{6,12})(?![A-Z0-9])/gim) ?? []
      : text.match(/(?:^|[^\d])(\d{3}-\d{7})(?!\d)/gm) ?? []
  const normalized = matches
    .map((match) =>
      carrier === 'rozetka'
        ? match.match(/PRM-\d{6,12}/i)?.[0] ?? ''
        : match.match(/\d{3}-\d{7}/)?.[0] ?? '',
    )
    .map((value) => canonicalOrderLabelTtn(carrier, value))
    .filter(Boolean)
  return [...new Set(normalized)]
}

export function orderLabelMailText(carrier: OrderLabelCarrier, ttn: string) {
  return `${carrier === 'rozetka' ? 'Розетка' : 'Мист'} ${canonicalOrderLabelTtn(carrier, ttn)}`
}
