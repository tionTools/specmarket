type RecordValue = Record<string, unknown>

const asRecord = (value: unknown): RecordValue =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {}
const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : ''
const number = (value: unknown) => Number(text(value).replace(/\s/g, '').replace(',', '.').replace(/[^\d.-]/g, '')) || 0
const pick = (record: RecordValue, ...keys: string[]) =>
  keys.map((key) => record[key]).find((value) => value !== undefined && value !== null && value !== '')
const readable = (value: unknown) => {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  const record = asRecord(value)
  return text(pick(record, 'title', 'name', 'label', 'value', 'description'))
}

function hasWebsiteCommissionMarker(value: unknown, depth = 0): boolean {
  if (depth > 4 || Array.isArray(value)) return false
  const record = asRecord(value)
  for (const [key, candidate] of Object.entries(record)) {
    if (/prosale/i.test(key)) {
      const commission = asRecord(candidate)
      const title = readable(commission.title).toLowerCase()
      if (number(commission.type) === 2 || /(?:с сайта|з сайту|site|website)/i.test(title)) return true
      continue
    }
    if (/(?:product|item|position)/i.test(key)) continue
    if (candidate && typeof candidate === 'object' && hasWebsiteCommissionMarker(candidate, depth + 1)) return true
  }
  return false
}

export function isPromWebsiteOrder(value: unknown): boolean {
  const order = asRecord(value)
  const source = text(order.source).trim().toLowerCase()
  if (source === 'mobile_catalog_app') return false
  return hasWebsiteCommissionMarker(order)
}

// Order-level fixed commissions are added on top of item/catalog commission.
// In rpay_parts, `commission` is a percentage (3.70), while `commission_amount`
// is the money amount (20.54). Only the money amount belongs in royalty.
export function promOrderLevelCommission(value: unknown, depth = 0): number {
  if (depth > 4 || Array.isArray(value)) return 0
  const record = asRecord(value)
  return Object.entries(record).reduce((total, [key, candidate]) => {
    if (/rpay[_-]?parts/i.test(key)) {
      const parts = asRecord(candidate)
      return total + number(pick(parts, 'commission_amount', 'commissionAmount'))
    }
    if (/prosale/i.test(key)) {
      const commission = asRecord(candidate)
      const title = readable(commission.title).toLowerCase()
      if (number(commission.type) === 2 || /(?:с сайта|з сайту|site|website)/i.test(title)) {
        return total + number(pick(commission, 'value', 'amount', 'price'))
      }
      return total
    }
    if (/(?:cpa|catalog)/i.test(key)) return total
    if (/(?:commission|royalty)/i.test(key)) {
      const amount = number(candidate) || number(pick(asRecord(candidate), 'amount', 'price', 'value'))
      return total + amount
    }
    if (/(?:product|item|position)/i.test(key)) return total
    return total + promOrderLevelCommission(candidate, depth + 1)
  }, 0)
}
