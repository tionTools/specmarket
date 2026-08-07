export type Platform = 'Пром' | 'Эпик' | 'Каста' | 'Р/С' | 'Сайт'

export interface OrderProduct {
  id: string
  name: string
  size: string
  quantity: number
  price: number
  cost: number
}

export interface Delivery {
  carrier: 'Новая почта' | 'Укрпочта' | 'RozetkaDelivery' | 'Meest'
  ttn: string
  city: string
  address: string
  status: string
  payer: string
}

export interface Order {
  id: number
  date: string
  customer: string
  phone: string
  platform: Platform
  status: string
  products: OrderProduct[]
  shipping: number
  acquiring: number
  delivery: Delivery
}
