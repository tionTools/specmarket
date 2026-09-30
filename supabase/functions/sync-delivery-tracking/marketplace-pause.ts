export const trackedMarketplacePlatforms = ['Пром', 'Эпицентр', 'Каста'] as const
type TrackedMarketplace = (typeof trackedMarketplacePlatforms)[number]
export type BulkTrackingEnabled = Record<TrackedMarketplace, boolean>

export function bulkTrackingEnabledFromRows(
  rows: Array<{ platform: string; enabled: boolean }>,
): BulkTrackingEnabled {
  const enabled = {} as BulkTrackingEnabled
  for (const platform of trackedMarketplacePlatforms) {
    const row = rows.find((item) => item.platform === platform)
    if (!row || typeof row.enabled !== 'boolean')
      throw new Error(`Настройка «${platform}» отсутствует или повреждена.`)
    enabled[platform] = row.enabled
  }
  return enabled
}

export function shouldBulkTrackPlatform(platform: unknown, enabled: BulkTrackingEnabled): boolean {
  if (typeof platform !== 'string') return true // Manually created orders without a marketplace.
  if (!trackedMarketplacePlatforms.some((candidate) => candidate === platform)) return true
  return enabled[platform as TrackedMarketplace]
}
