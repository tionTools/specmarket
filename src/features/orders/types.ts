export type Platform = 'Пром' | 'Эпицентр' | 'Каста' | 'Р/С' | 'Сайт'

export interface OrderProduct {
  id: string
  name: string
  size: string
  imageUrl?: string
  quantity: number
  price: number
  cost: number
  costUsd?: number
  royaltyPercent?: number
  royaltyAmount?: number
  royaltyManual?: boolean
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
  paymentAmount?: number
  paymentMethod?: string
  paymentStatus?: string
  hasWebsiteCommission?: boolean
  shippingSource?: 'manual' | 'seller-api' | 'prom-promo' | 'none'
  /** Последний статус, полученный из публичной tracking-ссылки перевозчика. */
  trackingStatus?: string
  trackingLastCheckedAt?: string
  trackingStatusChangedAt?: string
  trackingLastError?: string
  printCheckedAt?: string
  printedAt?: string
}

export interface Order {
  id: string | number
  orderNumber?: number
  displayNumber?: string
  remoteId?: string
  externalId?: string
  date: string
  time?: string
  customer: string
  phone: string
  customerEmail?: string
  customerComment?: string
  internalComment?: string
  platform: Platform
  status: string
  products: OrderProduct[]
  shipping: number
  paymentAmount?: number
  acquiring: number
  acquiringPercent?: number
  delivery: Delivery
}
