function isGenericReturnTrackingStatus(value: string) {
  return /відмова від (?:одержання|отримання)|^(?:отменено|скасовано|cancelled?)$|возвращается отправителю|повертається відправнику|return(?:ing| to sender)/i.test(
    value,
  )
}

export function isReturningDelivery(
  rawStatus?: string,
  normalizedStatus?: string,
  returnInProgress = false,
) {
  if (returnInProgress) return true
  const normalized = normalizedStatus?.trim().toLowerCase() ?? ''
  if (normalized === 'returning') return true
  const raw = rawStatus?.trim().toLowerCase() ?? ''
  return /відмова від (?:одержання|отримання)|возвращ|поверта|return(?:ing| to sender)/.test(raw)
}

export function deliveryReturnStatus(
  rawStatus?: string,
  normalizedStatus?: string,
  returnInProgress = false,
) {
  return isReturningDelivery(rawStatus, normalizedStatus, returnInProgress)
    ? 'Возвращается отправителю'
    : ''
}

export function currentReturnTrackingStatus(
  rawStatus?: string,
  normalizedStatus?: string,
  returnInProgress = false,
) {
  if (!isReturningDelivery(rawStatus, normalizedStatus, returnInProgress)) return ''
  const raw = rawStatus?.trim() ?? ''
  if (!raw || isGenericReturnTrackingStatus(raw)) return ''
  return `Текущий статус: ${raw}`
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

function trackingExpectedDeliveryTimestamp(value?: string) {
  const source = value?.trim() ?? ''
  if (!source) return Number.NaN
  const dayFirst = source.match(
    /^(\d{2})[-.](\d{2})[-.](\d{4})(?:[ T](\d{2}):(\d{2})(?::\d{2})?)?/,
  )
  if (dayFirst) {
    const [, day, month, year, hour, minute] = dayFirst
    return new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour ?? 23),
      Number(minute ?? 59),
    ).getTime()
  }
  const yearFirst = source.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::\d{2})?)?/,
  )
  if (yearFirst) {
    const [, year, month, day, hour, minute] = yearFirst
    return new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour ?? 23),
      Number(minute ?? 59),
    ).getTime()
  }
  return Date.parse(source)
}

export function expectedReturnLabel(
  rawStatus?: string,
  normalizedStatus?: string,
  expectedDeliveryAt?: string,
  returnInProgress = false,
  now = Date.now(),
) {
  if (!isReturningDelivery(rawStatus, normalizedStatus, returnInProgress)) return ''
  const expected = formatTrackingExpectedDeliveryAt(expectedDeliveryAt)
  if (!expected) return ''
  const expectedAt = trackingExpectedDeliveryTimestamp(expectedDeliveryAt)
  if (Number.isFinite(expectedAt) && expectedAt < now) return ''
  return `Ожидается возврат: ${expected}`
}

export function returnDestinationLabel(
  rawStatus?: string,
  normalizedStatus?: string,
  city?: string,
  address?: string,
  hasPreviousDestination = false,
  returnInProgress = false,
) {
  if (!isReturningDelivery(rawStatus, normalizedStatus, returnInProgress) || !hasPreviousDestination)
    return ''
  const destination = [city?.trim(), address?.trim()].filter(Boolean).join(', ')
  return destination ? `Возврат: ${destination}` : ''
}
