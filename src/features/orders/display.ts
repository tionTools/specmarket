export function displayCarrier(carrier: string) {
  const normalized = carrier
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  if (/^(?:cvz|pickup_point|collection_point)_epicent(?:e)?r$/.test(normalized))
    return 'Центр выдачи заказов — Эпицентр'
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
