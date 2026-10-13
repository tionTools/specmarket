export type TargetedFeedCoverage = {
  hasImage: boolean
  hasSize?: boolean
}

// Bulk sync retains full catalogue enrichment. Targeted sync only needs the feed for missing fields.
export function shouldLoadMarketplaceFeed(
  isTargeted: boolean,
  items: TargetedFeedCoverage[],
  requireSize = false,
): boolean {
  if (!isTargeted) return true
  return items.some((item) => !item.hasImage || (requireSize && !item.hasSize))
}
