import type { Order, Platform } from '@/features/orders/types'

export function displayCarrier(carrier: string) {
  const normalized = carrier
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  if (/^(?:cvz|pickup_point|collection_point)_epicent(?:e)?r$/.test(normalized))
    return 'ЦВЗ Эпицентр'
  if (
    normalized === 'parcel_box_epicentr' ||
    normalized === 'meest_epicentr_postomat' ||
    normalized === 'meest_epicentr_parcel_box'
  )
    return 'Поштомат Эпицентр'
  if (normalized === 'nova_poshta' || normalized === 'novaposhta') return 'Новая почта'
  if (normalized === 'ukrposhta' || normalized === 'ukr_poshta') return 'Укрпочта'
  if (normalized === 'rozetka_delivery' || normalized === 'rozetkadelivery')
    return 'Rozetka Delivery'
  if (normalized === 'meest' || normalized === 'meest_express') return 'Meest'
  if (normalized === 'epicentr') return 'Эпицентр'
  return carrier
}

export function orderBusinessPlatform(order: Pick<Order, 'platform' | 'delivery'>): Platform {
  return order.platform === 'Пром' && order.delivery.hasWebsiteCommission === true
    ? 'Сайт'
    : order.platform
}

export function formatUkrainianPhone(phone: string) {
  const digits = phone.replace(/\D/g, '')
  const national = /^380\d{9}$/.test(digits)
    ? digits.slice(2)
    : /^0\d{9}$/.test(digits)
      ? digits
      : ''
  if (!national) return phone
  return `+38 ${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6, 8)} ${national.slice(8, 10)}`
}
