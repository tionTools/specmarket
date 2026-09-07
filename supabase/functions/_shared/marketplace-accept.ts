type RecordValue = Record<string, unknown>

const asRecord = (value: unknown): RecordValue =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : {}

const text = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''

export function normalizeExternalIds(value: unknown, prefix?: string) {
  if (!Array.isArray(value) || value.length > 100)
    throw new Error('Некорректный список заказов.')

  const ids = value
    .map((item) => (typeof item === 'string' || typeof item === 'number' ? String(item).trim() : ''))
    .filter(Boolean)
  if (ids.length !== value.length) throw new Error('Некорректный идентификатор заказа.')

  const normalized = ids.map((id) =>
    prefix ? id.replace(new RegExp(`^${prefix}:`, 'i'), '') : id,
  )
  if (normalized.some((id) => !/^[1-9]\d*$/.test(id)))
    throw new Error('Некорректный идентификатор заказа.')
  return [...new Set(normalized)]
}

export function isNewMarketplaceStatus(status: unknown) {
  return ['new', 'новый', 'новий', 'created'].includes(text(status).toLowerCase())
}

export function isAcceptedMarketplaceStatus(status: unknown) {
  return [
    'принято',
    'підтверджено',
    'подтверждено',
    'підтверджено продавцем',
    'confirmed',
    'confirmed_by_seller',
    'confirmed_by_merchant',
    'confirmedbysupplier',
    'accepted',
  ].includes(text(status).toLowerCase())
}

export function epicentrConfirmationStatus(allowed: unknown) {
  const root = asRecord(allowed)
  const values = Array.isArray(allowed)
    ? allowed
    : Array.isArray(root.data)
      ? root.data
      : []

  for (const item of values) {
    const value =
      typeof item === 'string'
        ? item
        : text(asRecord(item).code) || text(asRecord(item).status)
    if (['confirmed_by_seller', 'confirmed_by_merchant', 'confirmed'].includes(value.toLowerCase()))
      return value
  }
  return undefined
}

export function epicentrOrderStatus(payload: unknown) {
  const root = asRecord(payload)
  const data = asRecord(root.data)
  const candidates = [
    asRecord(data.order),
    data,
    asRecord(root.order),
    root,
  ]

  for (const candidate of candidates) {
    for (const key of ['statusCode', 'status_code', 'orderStatus', 'order_status', 'status']) {
      const value = candidate[key]
      const direct = text(value)
      if (direct) return direct
      const nested = asRecord(value)
      const nestedValue = text(nested.code) || text(nested.status) || text(nested.name)
      if (nestedValue) return nestedValue
    }
  }
  return ''
}
