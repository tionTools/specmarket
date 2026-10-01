import type { Order, OrderProduct } from './types'

const remoteOrdersSessionCacheKey = 'specmarket-crm-remote-orders-session-v2'
const legacyRemoteOrdersSessionCacheKey = 'specmarket-crm-remote-orders-session-v1'
const cachedPlatforms = new Set(['Пром', 'Эпицентр', 'Каста', 'Р/С', 'Сайт'])

type RemoteOrdersSessionCache = {
  userId: string
  orders: Order[]
  versions: Record<string, string>
}

function sessionStorageAvailable(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isOptionalFiniteNumber(value: unknown) {
  return value === undefined || isFiniteNumber(value)
}

function isOptionalString(value: unknown) {
  return value === undefined || typeof value === 'string'
}

function isOptionalBoolean(value: unknown) {
  return value === undefined || typeof value === 'boolean'
}

function isOptionalStringArray(value: unknown) {
  return value === undefined || (Array.isArray(value) && value.every((item) => typeof item === 'string'))
}

function isCachedShipmentHistory(value: unknown) {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.every(
        (entry) =>
          isRecord(entry) &&
          typeof entry.ttn === 'string' &&
          typeof entry.relation === 'string' &&
          isOptionalString(entry.relatedTtn),
      ))
  )
}

function isCachedOrderProduct(value: unknown): value is OrderProduct {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.size === 'string' &&
    isFiniteNumber(value.quantity) &&
    isFiniteNumber(value.price) &&
    isFiniteNumber(value.cost) &&
    isOptionalFiniteNumber(value.position) &&
    isOptionalFiniteNumber(value.costUsd) &&
    isOptionalString(value.imageUrl) &&
    isOptionalString(value.marketplaceProductKey) &&
    isOptionalBoolean(value.costManual) &&
    isOptionalString(value.priceItemId) &&
    isOptionalFiniteNumber(value.royaltyPercent) &&
    isOptionalFiniteNumber(value.royaltyAmount) &&
    isOptionalBoolean(value.royaltyManual) &&
    isOptionalFiniteNumber(value.returnedQuantity) &&
    isOptionalString(value.returnedAt)
  )
}

function isCachedDelivery(value: unknown): value is Order['delivery'] {
  if (!isRecord(value)) return false
  return (
    typeof value.carrier === 'string' &&
    typeof value.ttn === 'string' &&
    typeof value.recipient === 'string' &&
    typeof value.recipientPhone === 'string' &&
    typeof value.city === 'string' &&
    typeof value.address === 'string' &&
    typeof value.status === 'string' &&
    typeof value.payer === 'string' &&
    isOptionalFiniteNumber(value.paymentAmount) &&
    isOptionalStringArray(value.ttnHistory) &&
    isOptionalStringArray(value.addressHistory) &&
    isCachedShipmentHistory(value.shipmentHistory) &&
    isOptionalStringArray(value.rozetkaPayOperationIds)
  )
}

function isCachedRemoteOrder(value: unknown): value is Order {
  if (!isRecord(value)) return false
  const validId =
    typeof value.id === 'string' || (typeof value.id === 'number' && Number.isFinite(value.id))
  return (
    validId &&
    typeof value.remoteId === 'string' &&
    Boolean(value.remoteId.trim()) &&
    typeof value.date === 'string' &&
    typeof value.customer === 'string' &&
    typeof value.phone === 'string' &&
    typeof value.platform === 'string' &&
    cachedPlatforms.has(value.platform) &&
    typeof value.status === 'string' &&
    Array.isArray(value.products) &&
    value.products.every(isCachedOrderProduct) &&
    isFiniteNumber(value.shipping) &&
    isOptionalFiniteNumber(value.paymentAmount) &&
    isFiniteNumber(value.acquiring) &&
    isOptionalFiniteNumber(value.acquiringPercent) &&
    isOptionalFiniteNumber(value.extraExpenses) &&
    isCachedDelivery(value.delivery)
  )
}

export function readRemoteOrdersSessionCache(userId: string): RemoteOrdersSessionCache | null {
  const storage = sessionStorageAvailable()
  if (!storage) return null

  try {
    const raw = storage.getItem(remoteOrdersSessionCacheKey)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value)) return null

    const orders = value.orders
    const versions = value.versions
    if (
      value.userId !== userId ||
      !Array.isArray(orders) ||
      !orders.every(isCachedRemoteOrder) ||
      !isRecord(versions)
    )
      return null

    return {
      userId,
      orders,
      versions: Object.fromEntries(
        Object.entries(versions).filter(
          (entry): entry is [string, string] => Boolean(entry[0]) && typeof entry[1] === 'string',
        ),
      ),
    }
  } catch {
    return null
  }
}

export function writeRemoteOrdersSessionCache(
  userId: string,
  orders: Order[],
  versions: Map<string, string>,
) {
  const storage = sessionStorageAvailable()
  if (!storage) return

  const remoteOrders = orders.filter(
    (order): order is Order & { remoteId: string } =>
      typeof order.remoteId === 'string' && Boolean(order.remoteId.trim()),
  )
  const remoteIds = new Set(remoteOrders.map((order) => order.remoteId))
  const remoteVersions = Object.fromEntries(
    [...versions].filter(([remoteId, version]) => remoteIds.has(remoteId) && Boolean(version)),
  )

  try {
    storage.setItem(
      remoteOrdersSessionCacheKey,
      JSON.stringify({
        userId,
        orders: remoteOrders,
        versions: remoteVersions,
      } satisfies RemoteOrdersSessionCache),
    )
    storage.removeItem(legacyRemoteOrdersSessionCacheKey)
  } catch {
    // Cache is optional. A storage quota/privacy error must not block CRM usage.
  }
}

export function clearRemoteOrdersSessionCache() {
  const storage = sessionStorageAvailable()
  if (!storage) return
  for (const key of [remoteOrdersSessionCacheKey, legacyRemoteOrdersSessionCacheKey]) {
    try {
      storage.removeItem(key)
    } catch {
      // Ignore optional cache cleanup failures.
    }
  }
}
