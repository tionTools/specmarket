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

export function isNovaPoshtaCarrier(carrier: string) {
  const normalized = carrier
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  return (
    normalized === 'nova_poshta' ||
    normalized === 'novaposhta' ||
    normalized === 'новая_почта' ||
    normalized === 'нова_пошта'
  )
}

export function formatDeliveryTtn(carrier: string, ttn: string) {
  if (!isNovaPoshtaCarrier(carrier)) return ttn
  const digits = ttn.replace(/\D/g, '')
  if (digits.length !== 14) return ttn
  return `${digits.slice(0, 2)} ${digits.slice(2, 6)} ${digits.slice(6, 10)} ${digits.slice(10, 14)}`
}

export function deliveryTtnForClipboard(carrier: string, ttn: string) {
  return isNovaPoshtaCarrier(carrier) ? ttn.replace(/\D/g, '') : ttn
}

export function displayDeliveryAddress(city: string, address: string) {
  const normalizedCity = city.trim()
  const normalizedAddress = address.trim()
  if (!normalizedAddress) return normalizedCity || '—'
  if (
    !normalizedCity ||
    normalizedAddress.toLocaleLowerCase().includes(normalizedCity.toLocaleLowerCase())
  )
    return normalizedAddress
  return `${normalizedCity}, ${normalizedAddress}`
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
