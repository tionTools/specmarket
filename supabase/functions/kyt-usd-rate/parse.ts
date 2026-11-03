export function retailUsdSale(html: string): number {
  const pairs = [...html.matchAll(/<div\s+class="pair"[^>]*>[\s\S]*?<div\s+class="pair__name">\s*USD\/UAH\s*<\/div>([\s\S]*?)<div\s+class="clear60"/gi)]
  if (pairs.length !== 1) throw new Error('USD/UAH не найден на странице КИТ Обмін.')
  const sale = pairs[0]?.[1]?.match(/<li\s+class="pair__block"\s+data-title="Продажа"[^>]*>([\s\S]*?)<\/li>/i)?.[1]
  const raw = sale?.match(/<div\s+class="pair__block-retail"[^>]*>[\s\S]*?<div\s+class="pair__block-num">\s*([^<]+)\s*<\/div>/i)?.[1]?.trim()
  if (!raw || !/^\d{1,3}(?:[.,]\d{1,4})?$/.test(raw)) throw new Error('Розничный курс продажи USD не найден.')
  const rate = Number(raw.replace(',', '.'))
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('Некорректный курс продажи USD.')
  return rate
}
