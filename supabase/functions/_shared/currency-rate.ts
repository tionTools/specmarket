import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export type CurrencyRateRow = {
  effectiveFrom: string
  rate: number
}

function dateKey(value: unknown) {
  const source = String(value ?? '').trim()
  const iso = source.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const european = source.match(/^(\d{2})\.(\d{2})\.(\d{4})/)
  if (european) return `${european[3]}-${european[2]}-${european[1]}`
  return ''
}

export async function loadUsdRateSchedule(admin: SupabaseClient): Promise<CurrencyRateRow[]> {
  const { data, error } = await admin
    .from('crm_currency_rates')
    .select('effective_from, rate')
    .eq('currency', 'USD')
    .order('effective_from', { ascending: true })
  if (error) throw error

  return (data ?? [])
    .map((row) => ({
      effectiveFrom: String(row.effective_from ?? ''),
      rate: Number(row.rate ?? 0),
    }))
    .filter((row) => Boolean(row.effectiveFrom) && row.rate > 0)
}

export function usdRateForDate(
  rates: CurrencyRateRow[],
  value: unknown,
  fallback = 0,
) {
  const date = dateKey(value)
  if (!date) return fallback
  let selected = fallback
  let selectedDate = ''
  for (const row of rates) {
    if (row.effectiveFrom <= date && row.effectiveFrom >= selectedDate && row.rate > 0) {
      selected = row.rate
      selectedDate = row.effectiveFrom
    }
  }
  return selected
}
