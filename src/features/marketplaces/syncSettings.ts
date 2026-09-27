export const marketplacePlatforms = ['Пром', 'Эпицентр', 'Каста'] as const

export type MarketplacePlatform = (typeof marketplacePlatforms)[number]
export type MarketplaceEnabled = Record<MarketplacePlatform, boolean>

export function defaultMarketplaceEnabled(): MarketplaceEnabled {
  return { Пром: true, Эпицентр: true, Каста: true }
}

export function marketplaceEnabledFromRows(
  rows: Array<{ platform: string; enabled: boolean }>,
): MarketplaceEnabled {
  const result = defaultMarketplaceEnabled()
  for (const platform of marketplacePlatforms) {
    const row = rows.find((item) => item.platform === platform)
    if (!row || typeof row.enabled !== 'boolean')
      throw new Error(`Настройка «${platform}» отсутствует или повреждена.`)
    result[platform] = row.enabled
  }
  return result
}
