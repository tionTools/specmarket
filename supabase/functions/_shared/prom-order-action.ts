const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : ''

export function normalizePromExternalIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' && typeof id !== 'number')) {
    throw new Error('Неверный список заказов Prom для принятия.')
  }
  const ids = [...new Set(value.map(text).map((id) => id.trim().replace(/^prom:/i, '').trim()).filter(Boolean))]
  if (ids.length > 100 || ids.some((id) => !/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0)) {
    throw new Error('Неверные ID заказов Prom для принятия.')
  }
  return [...new Set(ids.map((id) => String(Number(id))))]
}

export type PromOrderState = 'new' | 'alreadyAccepted' | 'forbidden'

export function classifyPromOrderStatus(value: unknown): PromOrderState {
  const status = text(value).trim().toLowerCase()
  if (['новий', 'новый', 'new', 'pending'].includes(status)) return 'new'
  if (['принято', 'принят', 'прийнято', 'received', 'accepted'].includes(status)) return 'alreadyAccepted'
  return 'forbidden'
}

export function canAcceptPromOrder(platform: unknown, status: unknown) {
  return text(platform).trim().toLowerCase() === 'пром' && classifyPromOrderStatus(status) === 'new'
}

export type AcceptanceOrder = { id: string; external_id: string; status: string; updated_at: string }
export function promConfirmedAcceptance(payload: unknown, ids: number[]): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false
  const result = payload as Record<string, unknown>
  if (!Array.isArray(result.processed_ids)) return false
  return ids.every((id) => (result.processed_ids as unknown[]).includes(id))
}

export type AcceptancePorts = {
  load: (externalIds: string[]) => Promise<AcceptanceOrder[]>
  setReceived: (ids: number[]) => Promise<boolean>
  save: (order: AcceptanceOrder) => Promise<boolean>
}

// The timestamp condition in save prevents a concurrent CRM edit from being overwritten.
export async function acceptPromOrders(ids: string[], ports: AcceptancePorts) {
  const rows = await ports.load(ids.map((id) => `prom:${id}`))
  const byId = new Map(rows.map((row) => [row.external_id, row]))
  const invalid = ids.filter((id) => !byId.has(`prom:${id}`) || classifyPromOrderStatus(byId.get(`prom:${id}`)?.status) === 'forbidden')
  if (invalid.length) return { status: 409, body: { ok: false, accepted: 0, changedOrderIds: [], message: 'Заказ отсутствует или его статус уже изменился. Обновите данные.' } }
  const pending = rows.filter((row) => classifyPromOrderStatus(row.status) === 'new')
  const alreadyAccepted = rows.filter((row) => classifyPromOrderStatus(row.status) === 'alreadyAccepted').map((row) => row.external_id)
  if (pending.length && !await ports.setReceived(pending.map((row) => Number(row.external_id.slice(5))))) {
    return { status: 502, body: { ok: false, accepted: 0, changedOrderIds: [], message: 'Prom не подтвердил принятие заказа. Обновите данные перед повтором.' } }
  }
  const changedOrderIds: string[] = []
  for (const row of pending) {
    if (!await ports.save(row)) {
      return { status: 409, body: { ok: false, accepted: changedOrderIds.length, changedOrderIds, alreadyAccepted, message: 'Prom принял заказ, но CRM изменилась одновременно. Обновите данные и запустите синхронизацию Prom.' } }
    }
    changedOrderIds.push(row.id)
  }
  return { status: 200, body: { ok: true, accepted: changedOrderIds.length, changedOrderIds, alreadyAccepted } }
}
