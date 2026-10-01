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
  onJournalChange: () => void
}) {
  const {
    supabase,
    user,
    isGuest,
    isOnline,
    documentVisibility,
    onPayment,
    onJournalChange,
  } = options
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
  let paymentCursor: number | null = null
  let catchUpPromise: Promise<void> | undefined
  let catchUpRequestedWhileRunning = false

  const active = () => Boolean(supabase && user.value && !isGuest.value)

  function applyCache(row: Record<string, unknown>) {
    if (!isBankName(row.bank)) return
    const value = Number(row.balance)
    caches.value[row.bank] = {
      balance: row.balance === null || !Number.isFinite(value) ? null : value,
      updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
    }
  }

  function paymentFromRow(row: Record<string, unknown>): BankPaymentEvent | null {
    const amount = Number(row.amount)
    if (!isBankName(row.bank) || !Number.isFinite(amount) || amount <= 0) return null
    return {
      bank: row.bank,
      amount,
      payer: typeof row.payer === 'string' ? row.payer : '',
      description: typeof row.description === 'string' ? row.description : '',
      comment: typeof row.comment === 'string' ? row.comment : '',
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

  async function initializePaymentCursor() {
    if (!supabase || !active()) return
    const { data, error } = await supabase
      .from('bank_payment_events')
      .select('id')
      .order('id', { ascending: false })
      .limit(1)
    if (error) {
      console.error('Не удалось установить точку отсчёта банковских уведомлений:', error)
      return
    }
    const id = Number(data?.[0]?.id)
    paymentCursor = Number.isSafeInteger(id) && id > 0 ? id : 0
  }

  async function catchUpPayments() {
    if (!supabase || !active()) return
    if (catchUpPromise) {
      catchUpRequestedWhileRunning = true
      return catchUpPromise
    }

    catchUpPromise = (async () => {
      if (paymentCursor === null) {
        await initializePaymentCursor()
        return
      }

      do {
        catchUpRequestedWhileRunning = false
        let cursor = paymentCursor
        while (true) {
          const { data, error } = await supabase
            .from('bank_payment_events')
            .select('id,bank,amount,payer,description,comment')
            .gt('id', cursor)
            .order('id', { ascending: true })
            .limit(200)
          if (error) {
            console.error('Не удалось сверить пропущенные банковские поступления:', error)
            return
          }

          const rows = (data ?? []) as Array<Record<string, unknown>>
          if (!rows.length) break

          for (const row of rows) {
            const id = Number(row.id)
            if (!Number.isSafeInteger(id) || id <= cursor) continue
            const payment = paymentFromRow(row)
            if (payment) onPayment(payment)
            cursor = id
          }

          paymentCursor = Math.max(paymentCursor ?? 0, cursor)
          if (rows.length < 200) break
        }
      } while (catchUpRequestedWhileRunning)
    })().finally(() => {
      catchUpPromise = undefined
    })

    return catchUpPromise
  }

  async function reconcile() {
    if (!active()) return
    await Promise.all([load(), catchUpPayments()])
    onJournalChange()
  }

  function startRealtime() {
    if (!supabase || !active() || channel) return
    channel = supabase
      .channel('crm:banking', { config: { private: true } })
      .on('broadcast', { event: 'bank_cache_changed' }, ({ payload }) => {
        applyCache(payload as Record<string, unknown>)
      })
      .on('broadcast', { event: 'bank_payment_inserted' }, () => {
        void catchUpPayments()
      })
      .on('broadcast', { event: 'novapay_journal_changed' }, () => {
        onJournalChange()
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void reconcile()
      })
  }

  async function start() {
    if (!active()) return
    await initializePaymentCursor()
    await load()
    startRealtime()
  }

  function stop() {
    if (supabase && channel) void supabase.removeChannel(channel)
    channel = undefined
    catchUpPromise = undefined
    catchUpRequestedWhileRunning = false
  }

  function handleVisibilityChange() {
    if (documentVisibility.value === 'visible') void reconcile()
  }

  function handleOnline() {
    if (isOnline.value) void reconcile()
  }

  return {
    caches,
    totalBalance,
    start,
    stop,
    handleVisibilityChange,
    handleOnline,
  }
}
