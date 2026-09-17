import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

type BankName = 'monobank' | 'novapay'

type BankNotification = {
  bank: BankName
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
  return new Intl.NumberFormat('uk-UA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value).replaceAll('\u00a0', ' ')
}

function bankLabel(bank: BankName) {
  return bank === 'monobank' ? 'Monobank ФОП' : 'NovaPay ФОП'
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

  const label = bankLabel(notification.bank)
  const amount = `+${money(notification.amount)} ₴`
  const balance = notification.balance === null ? '—' : `${money(notification.balance)} ₴`
  const payer = text(notification.payer) || '—'
  const purpose = text(notification.purpose) || '—'
  const subject = `💰 ${label}: ${amount}`
  const body = [
    `Новый приход на ${label}`,
    '',
    `Зачислено: ${amount}`,
    `Текущий остаток: ${balance}`,
    '',
    `Плательщик: ${payer}`,
    `Назначение: ${purpose}`,
    '',
    'Ваш финансовый помощник',
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
