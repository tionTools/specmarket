import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { RealtimeChannel, SupabaseClient, User } from '@supabase/supabase-js'
import type { BankName, BankPaymentEvent, BankState } from './types'

const isBankName = (value: unknown): value is BankName => value === 'monobank' || value === 'novapay'

export function useBankingMonitor(options: {
  supabase: SupabaseClient | null
  user: Ref<User | null>
  isGuest: ComputedRef<boolean>
  isOnline: Ref<boolean>
  documentVisibility: Ref<DocumentVisibilityState>
  onPayment: (event: BankPaymentEvent) => void
}) {
  const { supabase, user, isGuest, onPayment } = options
  const caches = ref<BankState>({
    monobank: { balance: null, updatedAt: null },
    novapay: { balance: null, updatedAt: null },
  })
  const totalBalance = computed(() => {
    const values = Object.values(caches.value)
      .map((cache) => cache.balance)
      .filter((value): value is number => value !== null)
    return values.length ? values.reduce((total, value) => total + value, 0) : null
  })
  let channel: RealtimeChannel | undefined

  const active = () => Boolean(supabase && user.value && !isGuest.value)

  function applyCache(row: Record<string, unknown>) {
    if (!isBankName(row.bank)) return
    const value = Number(row.balance)
    caches.value[row.bank] = {
      balance: row.balance === null || !Number.isFinite(value) ? null : value,
      updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
    }
  }

  async function load() {
    if (!supabase || !active()) return
    const { data, error } = await supabase
      .from('bank_account_cache')
      .select('bank,balance,updated_at')
      .in('bank', ['monobank', 'novapay'])
    if (error) return console.error('Не удалось загрузить остатки банков:', error)
    for (const row of data ?? []) applyCache(row as Record<string, unknown>)
  }

  function startRealtime() {
    if (!supabase || !active() || channel) return
    channel = supabase
      .channel('crm:banking')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'bank_account_cache' },
        (payload) => applyCache(payload.new as Record<string, unknown>),
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'bank_payment_events' },
        (payload) => {
          const row = payload.new as Record<string, unknown>
          const amount = Number(row.amount)
          if (!isBankName(row.bank) || !Number.isFinite(amount) || amount <= 0) return
          onPayment({
            bank: row.bank,
            amount,
            payer: typeof row.payer === 'string' ? row.payer : '',
            description: typeof row.description === 'string' ? row.description : '',
            comment: typeof row.comment === 'string' ? row.comment : '',
          })
        },
      )
      .subscribe()
  }

  async function start() {
    if (!active()) return
    await load()
    startRealtime()
  }

  function stop() {
    if (supabase && channel) void supabase.removeChannel(channel)
    channel = undefined
  }

  const noAutomaticRefresh = () => undefined

  return {
    caches,
    totalBalance,
    start,
    stop,
    handleVisibilityChange: noAutomaticRefresh,
    handleOnline: noAutomaticRefresh,
  }
}
