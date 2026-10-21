type RecordValue = Record<string, unknown>

export type ValidatedOrderItem = {
  raw: RecordValue
  title: string
  quantity: number
  price: number
}

const record = (value: unknown): RecordValue =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : {}

const firstPresent = (...values: unknown[]) => values.find((value) => value !== undefined)
const title = (...values: unknown[]) =>
  values.find((value): value is string => typeof value === 'string' && Boolean(value.trim()))

function numeric(value: unknown, field: string): number {
  // Accept decimal strings, including grouped thousands, but never strip arbitrary text.
  const decimal = typeof value === 'string' ? value.trim() : ''
  if (
    typeof value !== 'number' &&
    !/^[+-]?(?:\d+|\d{1,3}(?:[ \u00a0\u202f]\d{3})+)(?:[.,]\d+)?$/.test(decimal)
  )
    throw new Error(`${field}: требуется число`)
  const result =
    typeof value === 'number'
      ? value
      : Number(decimal.replace(/[ \u00a0\u202f]/g, '').replace(',', '.'))
  if (!Number.isFinite(result) || result < 0) throw new Error(`${field}: недопустимое число`)
  return result
}

// Structural validation cannot detect an upstream response that silently omits valid lines.
export function validatedOrderItems(
  order: RecordValue,
  platform: 'Prom' | 'Epicentr',
): ValidatedOrderItem[] {
  const nested = record(order.order)
  const source =
    platform === 'Prom'
      ? firstPresent(order.products, order.items)
      : firstPresent(order.items, order.products, order.orderItems, nested.items, nested.products)
  if (source === undefined) throw new Error('Массив товарных позиций отсутствует')
  if (!Array.isArray(source)) throw new Error('Товарные позиции должны быть массивом')
  if (!source.length) throw new Error('Пустой состав заказа не подтверждён как безопасный')

  return source.map((value, index) => {
    const field = `Позиция ${index + 1}`
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error(`${field}: требуется объект`)
    const item = value as RecordValue
    const name =
      platform === 'Prom'
        ? title(item.name, item.product_name)
        : title(item.title, item.name, item.productName, record(item.product).title)
    if (!name) throw new Error(`${field}: отсутствует название`)
    const quantity = numeric(
      platform === 'Prom'
        ? firstPresent(item.quantity, item.amount)
        : firstPresent(item.quantity, item.qty, item.count),
      `${field}, количество`,
    )
    if (quantity <= 0) throw new Error(`${field}: количество должно быть положительным`)
    const directPrice =
      platform === 'Prom'
        ? firstPresent(
            item.price,
            item.price_uah,
            item.priceUAH,
            item.unit_price,
            item.base_price,
            item.cost,
          )
        : firstPresent(item.price, item.unitPrice, item.unit_price)
    const total =
      platform === 'Prom'
        ? firstPresent(item.total_price, item.subtotal, item.sum)
        : firstPresent(item.subtotal, item.total, item.amount)
    if (total !== undefined) numeric(total, `${field}, сумма`)
    const price =
      directPrice !== undefined
        ? numeric(directPrice, `${field}, цена`)
        : numeric(total, `${field}, сумма`) / quantity
    if (!Number.isFinite(price)) throw new Error(`${field}: недопустимая цена`)
    return { raw: item, title: name, quantity, price }
  })
}
