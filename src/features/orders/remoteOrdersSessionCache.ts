import type { Order } from './types'

const remoteOrdersSessionCacheKey = 'specmarket-crm-remote-orders-session-v1'

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

export function readRemoteOrdersSessionCache(userId: string): RemoteOrdersSessionCache | null {
  const storage = sessionStorageAvailable()
  if (!storage) return null

  try {
    const raw = storage.getItem(remoteOrdersSessionCacheKey)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<RemoteOrdersSessionCache>
    if (
      value.userId !== userId ||
      !Array.isArray(value.orders) ||
      value.orders.some(
        (order) =>
          !order ||
          typeof order !== 'object' ||
          Array.isArray(order) ||
          typeof (order as Partial<Order>).remoteId !== 'string' ||
          !(order as Partial<Order>).remoteId?.trim(),
      ) ||
      !value.versions ||
      typeof value.versions !== 'object' ||
      Array.isArray(value.versions)
    )
      return null

    return {
      userId,
      orders: value.orders,
      versions: Object.fromEntries(
        Object.entries(value.versions).filter(
          ([remoteId, version]) => remoteId && typeof version === 'string',
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
  } catch {
    // Cache is optional. A storage quota/privacy error must not block CRM usage.
  }
}

export function clearRemoteOrdersSessionCache() {
  const storage = sessionStorageAvailable()
  if (!storage) return
  try {
    storage.removeItem(remoteOrdersSessionCacheKey)
  } catch {
    // Ignore optional cache cleanup failures.
  }
}
