export function isReturningDelivery(rawStatus?: string, normalizedStatus?: string) {
  const normalized = normalizedStatus?.trim().toLowerCase() ?? ''
  if (normalized === 'returning') return true
  const raw = rawStatus?.trim().toLowerCase() ?? ''
  return /відмова від (?:одержання|отримання)|возвращ|поверта|return(?:ing| to sender)/.test(raw)
}

export function deliveryReturnStatus(rawStatus?: string, normalizedStatus?: string) {
  return isReturningDelivery(rawStatus, normalizedStatus) ? 'Возвращается отправителю' : ''
}

export function formatTrackingExpectedDeliveryAt(value?: string) {
  const source = value?.trim() ?? ''
  if (!source) return ''

  const dayFirst = source.match(
    /^(\d{2})[-.](\d{2})[-.](\d{4})(?:[ T](\d{2}):(\d{2})(?::\d{2})?)?/,
  )
  if (dayFirst) {
    const [, day, month, , hour, minute] = dayFirst
    return `${day}.${month}${hour && minute ? `, ${hour}:${minute}` : ''}`
  }

  const yearFirst = source.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::\d{2})?)?/,
  )
  if (yearFirst) {
    const [, , month, day, hour, minute] = yearFirst
    return `${day}.${month}${hour && minute ? `, ${hour}:${minute}` : ''}`
  }

  return source
}

export function expectedReturnLabel(
  rawStatus?: string,
  normalizedStatus?: string,
  expectedDeliveryAt?: string,
) {
  if (!isReturningDelivery(rawStatus, normalizedStatus)) return ''
  const expected = formatTrackingExpectedDeliveryAt(expectedDeliveryAt)
  return expected ? `Ожидается возврат: ${expected}` : ''
}

export function returnDestinationLabel(
  rawStatus?: string,
  normalizedStatus?: string,
  city?: string,
  address?: string,
  hasPreviousDestination = false,
) {
  if (normalizedStatus?.trim().toLowerCase() !== 'returning' || !hasPreviousDestination) return ''
  const destination = [city?.trim(), address?.trim()].filter(Boolean).join(', ')
  return destination ? `Возврат: ${destination}` : ''
}
