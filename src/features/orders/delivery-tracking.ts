const normalizedStatusLabels: Record<string, string> = {
  returning: 'Возвращается отправителю',
  returned: 'Возвращено',
  cancelled: 'Отменено',
  delivered: 'Получено',
  ready_for_pickup: 'Готово к выдаче',
  in_transit: 'В дороге',
  accepted: 'Принято перевозчиком',
  created: 'Запланировано',
}

export function secondaryDeliveryStatus(rawStatus?: string, normalizedStatus?: string) {
  const normalized = normalizedStatus?.trim().toLowerCase() ?? ''
  const label = normalizedStatusLabels[normalized] ?? ''
  if (!label) return ''
  const raw = rawStatus?.trim().toLowerCase() ?? ''
  return raw === label.toLowerCase() ? '' : label
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

export function expectedReturnLabel(normalizedStatus?: string, expectedDeliveryAt?: string) {
  if (normalizedStatus?.trim().toLowerCase() !== 'returning') return ''
  const expected = formatTrackingExpectedDeliveryAt(expectedDeliveryAt)
  return expected ? `Ожидается возврат: ${expected}` : ''
}
