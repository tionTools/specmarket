import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { NovaPayAuthError, NovaPayTransportError } from './novapay-auth.ts'

type Source = 'scheduled' | 'manual' | 'balance'
type Stage = 'starting' | 'authorization' | 'auth_request' | 'data_sync'

function codeFor(error: unknown) {
  const raw = error && typeof error === 'object' && 'code' in error ? error.code : null
  return typeof raw === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(raw)
    ? raw
    : 'NOVAPAY_INTERNAL_ERROR'
}

function reasonFor(error: unknown) {
  if (error instanceof NovaPayAuthError && error.reason && /^[a-zA-Z0-9_]{1,64}$/.test(error.reason))
    return error.reason
  if (error instanceof NovaPayTransportError) {
    if (error.message === 'AbortError') return 'timeout'
    if (/^http_[45][0-9]{2}$/.test(error.message)) return error.message
    return 'transport_failure'
  }
  return 'not_classified'
}

async function safeWrite(operation: string, run: () => PromiseLike<{ error: unknown }>) {
  try {
    const { error } = await run()
    if (error) console.error(`NovaPay sync journal ${operation} failed.`)
  } catch {
    console.error(`NovaPay sync journal ${operation} failed.`)
  }
}

export async function startNovaPaySyncAttempt(
  admin: SupabaseClient,
  id: string,
  source: Exclude<Source, 'balance'>,
) {
  await safeWrite('start', () => admin.from('crm_novapay_sync_log').insert({
    id, source, status: 'running', stage: 'starting',
  }))
}

export async function markNovaPaySyncAttempt(
  admin: SupabaseClient,
  id: string,
  stage: Stage,
  requestRef?: string,
) {
  const changes: { stage: Stage; request_ref?: string } = { stage }
  if (requestRef) changes.request_ref = requestRef
  await safeWrite('progress', () =>
    admin.from('crm_novapay_sync_log').update(changes).eq('id', id))
}

export async function completeNovaPaySyncAttempt(admin: SupabaseClient, id: string) {
  // Successful refreshes are already recorded in bank_account_cache.updated_at.
  await safeWrite('success', () => admin.from('crm_novapay_sync_log').delete().eq('id', id))
}

export async function failNovaPaySyncAttempt(
  admin: SupabaseClient,
  id: string,
  source: Source,
  stage: Stage,
  error: unknown,
  requestRef?: string,
) {
  await safeWrite('failure', () => admin.from('crm_novapay_sync_log').upsert({
    id, source, status: 'failed', stage, finished_at: new Date().toISOString(),
    code: codeFor(error), reason: reasonFor(error),
    ...(requestRef ? { request_ref: requestRef } : {}),
  }))
}

export async function recordNovaPayBalanceFailure(admin: SupabaseClient, error: unknown) {
  await failNovaPaySyncAttempt(admin, crypto.randomUUID(), 'balance', 'authorization', error)
}
