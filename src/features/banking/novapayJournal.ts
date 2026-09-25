export type NovaPayJournalRow = {
  id: string
  started_at: string
  finished_at: string | null
  source: 'scheduled' | 'manual' | 'balance'
  status: 'running' | 'failed'
  stage: string
  code: string | null
  reason: string | null
  request_ref: string | null
}

export function isInterruptedNovaPayRun(row: NovaPayJournalRow, now: Date) {
  return row.status === 'running' && now.getTime() - Date.parse(row.started_at) > 12 * 60_000
}

export function hasNovaPaySyncIssue(
  logs: NovaPayJournalRow[],
  lastSuccessAt: string | null,
  now: Date,
) {
  const successMs = lastSuccessAt ? Date.parse(lastSuccessAt) : Number.NaN
  const latestFailure = logs.some((entry) => {
    if (entry.source === 'balance') return false
    if (entry.status !== 'failed' && !isInterruptedNovaPayRun(entry, now)) return false
    const occurredMs = Date.parse(entry.finished_at ?? entry.started_at)
    return !Number.isFinite(successMs) || occurredMs > successMs
  })
  if (latestFailure) return true
  if (!Number.isFinite(successMs)) return false
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Kyiv',
    }).format(now),
  )
  const delay = hour >= 1 && hour < 7 ? 130 : 70
  return now.getTime() - successMs > delay * 60_000
}
