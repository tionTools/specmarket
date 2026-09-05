const supportedPlatforms = new Set(['Пром', 'Эпицентр'])
const genericSizePattern =
  '(?:5xl|4xl|xxxl|xxl|xl|xxs|xs|s|m|l|\\d{1,2}(?:[.,]\\d+)?)'

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeSize(value: string) {
  const normalized = value.trim().toLocaleLowerCase('uk-UA').replace(',', '.')
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return normalized
  const numeric = Number(normalized)
  return Number.isFinite(numeric) ? String(numeric) : normalized
}

function exactSizePattern(value: string) {
  const normalized = normalizeSize(value)
  if (/^\d+$/.test(normalized)) return `0*${String(Number(normalized))}`
  const decimal = normalized.match(/^(\d+)\.(\d+)$/)
  if (decimal) return `0*${String(Number(decimal[1]))}[.,]${escapeRegex(decimal[2] ?? '')}`
  return escapeRegex(normalized)
}

function normalizeFamilyText(value: string) {
  return value
    .toLocaleLowerCase('uk-UA')
    .replace(/[–—]/g, '-')
    .replace(/[’'`"]/g, '')
    .replace(/[()[\],.:;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function inferPriceLinkSizeFromTitle(productTitle: string) {
  const labelled = productTitle.match(
    new RegExp(
      `(?:розмір|размер|size|р\\.)\\s*[:№-]?\\s*(${genericSizePattern})(?![\\p{L}\\p{N}]|[.,]\\d)`,
      'iu',
    ),
  )?.[1]
  if (labelled) return normalizeSize(labelled)

  const trailing = productTitle.match(
    new RegExp(
      `(?:^|[\\s,])(${genericSizePattern})(?=\\s*(?:\\([^)]*\\))?\\s*$)`,
      'i',
    ),
  )?.[1]
  return trailing ? normalizeSize(trailing) : ''
}

function productFamilyTitle(productTitle: string, size: string) {
  if (!productTitle.trim() || !size) return ''
  const sizePattern = exactSizePattern(size)
  let familyTitle = productTitle
    .replace(
      new RegExp(`(?:розмір|размер|size|р\\.)\\s*[:№-]?\\s*${sizePattern}\\b`, 'gi'),
      ' ',
    )
    .replace(
      new RegExp(
        `([\\s,/_-])${sizePattern}(?=\\s*(?:\\([^)]*\\))?\\s*$)`,
        'i',
      ),
      ' ',
    )
    .replace(new RegExp(`([/_-])${sizePattern}(?=\\)\\s*$)`, 'i'), '')
  familyTitle = normalizeFamilyText(familyTitle)
  return familyTitle
}

function productFamilyCode(platform: string, marketplaceProductKey: string, size: string) {
  const separator = marketplaceProductKey.indexOf(':')
  if (separator <= 0 || !size) return ''
  const kind = marketplaceProductKey.slice(0, separator)
  const rawCode = marketplaceProductKey.slice(separator + 1).trim()
  const allowed =
    platform === 'Пром'
      ? kind === 'sku' || kind === 'external'
      : platform === 'Эпицентр'
        ? kind === 'offer'
        : false
  if (!allowed || !rawCode) return ''

  const match = rawCode.match(
    new RegExp(`^(.+?)[\\s._/-]+${exactSizePattern(size)}$`, 'i'),
  )
  const base = match?.[1]?.trim()
  if (!base) return ''
  return `family:code:${kind}:${base.toLocaleLowerCase('uk-UA').replace(/\s+/g, '')}`
}

export function priceLinkFamilyAliases(
  platform: string,
  marketplaceProductKey: string,
  productTitle: string,
  size: string,
) {
  if (!supportedPlatforms.has(platform)) return []

  const resolvedSize = normalizeSize(size) || inferPriceLinkSizeFromTitle(productTitle)
  if (!resolvedSize) return []

  const aliases = new Set<string>()
  const familyCode = productFamilyCode(platform, marketplaceProductKey, resolvedSize)
  if (familyCode) aliases.add(familyCode)

  const familyTitle = productFamilyTitle(productTitle, resolvedSize)
  if (familyTitle) aliases.add(`family:title:${familyTitle}`)

  return [...aliases]
}
