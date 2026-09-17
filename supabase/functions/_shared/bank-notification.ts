import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

type BankName = 'monobank' | 'novapay'

type BankNotification = {
  bank: BankName
  occurredAt: string
  amount: number
  balance: number | null
  payer: string
  purpose: string
}

const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function money(value: number) {
  return value.toFixed(2)
}

function dateTime(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value || '—'
  const parts = new Intl.DateTimeFormat('uk-UA', {
    timeZone: 'Europe/Kyiv',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('day')}.${part('month')}.${part('year')}, ${part('hour')}:${part('minute')}:${part('second')}`
}

export async function sendBankPaymentEmail(
  admin: SupabaseClient,
  notification: BankNotification,
) {
  const { data: setting, error: settingError } = await admin
    .from('bank_notification_settings')
    .select('recipient_email')
    .eq('id', 1)
    .maybeSingle()

  if (settingError) {
    console.error('Bank notification email setting read failed.', settingError.message)
    return false
  }

  const recipient = text(setting?.recipient_email).toLowerCase()
  if (!validEmail(recipient)) return false

  const resendApiKey = text(Deno.env.get('RESEND_API_KEY'))
  const resendFromEmail = text(Deno.env.get('RESEND_FROM_EMAIL'))
  if (!resendApiKey || !resendFromEmail) {
    console.error('Bank notification email is not configured: missing Resend secrets.')
    return false
  }

  const amount = money(notification.amount)
  const balance = notification.balance === null ? '—' : money(notification.balance)
  const payer = text(notification.payer)
  const purpose = text(notification.purpose) || '—'
  const description = payer ? `Від: ${payer}` : '—'
  const subject = `💰 Нове надходження: ${amount} грн`
  const body = [
    `Дата: ${dateTime(notification.occurredAt)}`,
    `Сумма: ${amount} грн`,
    `Описание: ${description}`,
    `Баланс: ${balance}${balance === '—' ? '' : ' грн'}`,
    `Коммент: ${purpose}`,
  ].join('\n')

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: resendFromEmail,
        to: [recipient],
        subject,
        text: body,
      }),
    })

    if (!response.ok) {
      console.error(`Bank notification email failed: Resend HTTP ${response.status}.`)
      return false
    }
    return true
  } catch (error) {
    console.error('Bank notification email transport failed.', error instanceof Error ? error.message : error)
    return false
  }
}
