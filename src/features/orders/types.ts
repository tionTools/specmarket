export type Platform = 'Пром' | 'Эпицентр' | 'Каста' | 'Р/С' | 'Сайт'

export interface OrderProduct {
  id: string
  name: string
  size: string
  quantity: number
  price: number
  cost: number
  royaltyPercent?: number
  royaltyAmount?: number
}

export interface Delivery {
  carrier: 'Новая почта' | 'Укрпочта' | 'RozetkaDelivery' | 'Meest'
  ttn: string
  recipient: string
  recipientPhone: string
  city: string
  address: string
  status: string
  payer: string
  isAlternateRecipient?: boolean
}

export interface Order {
  id: number
  remoteId?: string
  externalId?: string
  date: string
  time?: string
  customer: string
  phone: string
  customerEmail?: string
  customerComment?: string
  platform: Platform
  status: string
  products: OrderProduct[]
  shipping: number
  acquiring: number
  acquiringPercent?: number
  delivery: Delivery
}
