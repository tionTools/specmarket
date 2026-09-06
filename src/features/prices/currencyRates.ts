export type CurrencyRateRow = {
  effective_from: string
  rate: number | string
}

export function localDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function normalizeCurrencyDate(value: string | Date) {
  if (value instanceof Date) return localDateKey(value)
  const source = String(value ?? '').trim()
  const iso = source.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const european = source.match(/^(\d{2})\.(\d{2})\.(\d{4})/)
  if (european) return `${european[3]}-${european[2]}-${european[1]}`
  return ''
}

export function currencyRateEntryForDate(
  rates: CurrencyRateRow[],
  value: string | Date,
): CurrencyRateRow | null {
  const date = normalizeCurrencyDate(value)
  if (!date) return null
  return (
    [...rates]
      .filter((row) => row.effective_from <= date && Number(row.rate) > 0)
      .sort((left, right) => right.effective_from.localeCompare(left.effective_from))[0] ?? null
  )
}

export function currencyRateForDate(rates: CurrencyRateRow[], value: string | Date, fallback = 0) {
  const rate = Number(currencyRateEntryForDate(rates, value)?.rate ?? 0)
  return rate > 0 ? rate : fallback
}
