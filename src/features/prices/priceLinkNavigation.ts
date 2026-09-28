const priceLinkNavigationStorageKey = 'specmarket-crm-price-link-navigation'
const priceLinkNavigationTtlMs = 15 * 60_000

export type PriceLinkNavigationQuery = {
  linkMode: '1'
  linkPlatform: 'Пром' | 'Эпицентр' | 'Каста'
  linkProductKey: string
  linkOrderRemoteId: string
  linkPosition: string
  linkTitle: string
  linkSize?: string
  returnOrder?: string
  returnSearch?: string
  returnRegistry?: '1'
}

type StoredPriceLinkNavigation = {
  savedAt: number
  query: PriceLinkNavigationQuery
}

function isPriceLinkNavigationQuery(value: unknown): value is PriceLinkNavigationQuery {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const query = value as Partial<PriceLinkNavigationQuery>
  return (
    query.linkMode === '1' &&
    (query.linkPlatform === 'Пром' ||
      query.linkPlatform === 'Эпицентр' ||
      query.linkPlatform === 'Каста') &&
    typeof query.linkProductKey === 'string' &&
    query.linkProductKey.length > 0 &&
    typeof query.linkOrderRemoteId === 'string' &&
    query.linkOrderRemoteId.length > 0 &&
    typeof query.linkPosition === 'string' &&
    /^\d+$/.test(query.linkPosition) &&
    typeof query.linkTitle === 'string'
  )
}

export function savePriceLinkNavigationIntent(query: PriceLinkNavigationQuery) {
  try {
    window.sessionStorage.setItem(
      priceLinkNavigationStorageKey,
      JSON.stringify({ savedAt: Date.now(), query } satisfies StoredPriceLinkNavigation),
    )
  } catch {}
}

export function loadPriceLinkNavigationIntent(): PriceLinkNavigationQuery | null {
  let raw: string | null = null
  try {
    raw = window.sessionStorage.getItem(priceLinkNavigationStorageKey)
  } catch {
    return null
  }
  if (!raw) return null

  try {
    const stored = JSON.parse(raw) as Partial<StoredPriceLinkNavigation>
    if (
      typeof stored.savedAt !== 'number' ||
      !Number.isFinite(stored.savedAt) ||
      Date.now() - stored.savedAt > priceLinkNavigationTtlMs ||
      !isPriceLinkNavigationQuery(stored.query)
    ) {
      clearPriceLinkNavigationIntent()
      return null
    }
    return stored.query
  } catch {
    clearPriceLinkNavigationIntent()
    return null
  }
}

export function clearPriceLinkNavigationIntent() {
  try {
    window.sessionStorage.removeItem(priceLinkNavigationStorageKey)
  } catch {}
}
