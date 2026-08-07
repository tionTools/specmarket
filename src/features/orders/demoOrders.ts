import type { Order, Platform } from './types'

const deliveryDetails = [
  ['Новая почта', '20451234567890', 'Киев', 'Отделение № 32'],
  ['Meest', '722-4280155', 'Одесса', 'Отделение Meest № 12'],
  ['RozetkaDelivery', 'PRM-531988468', 'Львов', 'Точка выдачи Rozetka'],
  ['Укрпочта', '0501234567890', 'Днепр', 'Укрпочта № 5'],
] as const

const customers = [
  ['Ирина Андриядаки', '+380 97 223 76 48'],
  ['Оксана Коваленко', '+380 67 123 45 67'],
  ['Андрей Мельник', '+380 93 100 20 30'],
  ['Виктория С.', '+380 50 555 22 11'],
] as const

const recipients = [
  ['Ірина Андріадакі', '+380 97 223 76 48'],
  ['Олена Коваленко', '+380 67 111 22 33'],
  ['Андрій Мельник', '+380 93 100 20 30'],
  ['Вікторія Савчук', '+380 50 555 22 11'],
] as const

const platforms: Platform[] = [
  'Пром',
  'Каста',
  'Эпик',
  'Р/С',
  'Пром',
  'Каста',
  'Сайт',
  'Пром',
  'Эпик',
  'Пром',
  'Каста',
  'Р/С',
]
const statuses = [
  'Оплачено',
  'В дороге',
  'Відправлено',
  'Закрыт',
  'Прийнято',
  'Закрыт',
  'В дороге',
  'Виконано',
  'Готово до видачі',
  'Скасовано',
  'Возврат',
  'Закрыт',
]

function getDemoValue<T>(values: readonly T[], index: number): T {
  const value = values[index % values.length]
  if (value === undefined) {
    throw new Error('Demo CRM data is incomplete')
  }
  return value
}

export const demoOrders: Order[] = Array.from({ length: 12 }, (_, index) => {
  const delivery = getDemoValue(deliveryDetails, index)
  const customer = getDemoValue(customers, index)
  const recipient = getDemoValue(recipients, index)
  const platform = getDemoValue(platforms, index)
  const price = getDemoValue(
    [105, 471, 1_295, 3_915, 240, 509, 720, 480, 1_550, 210, 630, 1_120],
    index,
  )
  const cost = getDemoValue([61, 291, 980, 2_583, 147, 330, 470, 293, 1_120, 122, 529, 845], index)

  return {
    id: 306 - index,
    date: index < 4 ? '07.08.2026' : index < 8 ? '06.08.2026' : '31.07.2026',
    customer: customer[0],
    phone: customer[1],
    platform,
    status: getDemoValue(statuses, index),
    products: [
      {
        id: `product-${index}-1`,
        name: getDemoValue(
          ['Шит 9/5', 'BHP 201', 'Ботинки BHP 128', 'Бримпульс', 'Шит 9/12', 'Urgent 206'],
          index,
        ),
        size: getDemoValue(['M', 'L', '42', '41–43', 'XL', '39'], index),
        quantity: 1,
        price,
        cost,
      },
    ],
    shipping: getDemoValue([90, 25, 39, 0, 10, 25], index),
    acquiring: getDemoValue([1.79, 11.71, 18.2, 0, 2.4, 11.71], index),
    delivery: {
      carrier: delivery[0],
      ttn: delivery[1],
      recipient: recipient[0],
      recipientPhone: recipient[1],
      city: delivery[2],
      address: delivery[3],
      status: index % 3 === 0 ? 'Запланировано' : 'Отправлено',
      payer: 'Получатель',
    },
  }
})
