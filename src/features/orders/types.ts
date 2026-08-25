export type Platform = 'Пром' | 'Эпицентр' | 'Каста' | 'Р/С' | 'Сайт'

export interface OrderProduct {
  id: string
  position?: number
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
  returnedQuantity?: number
  returnedAt?: string
}

export interface Delivery {
  carrier: 'Новая почта' | 'Укрпочта' | 'RozetkaDelivery' | 'Meest'
  ttn: string
  /** Предыдущие ТТН при переадресациях Prom. */
  ttnHistory?: string[]
  recipient: string
  recipientPhone: string
  city: string
  address: string
  /** Полные предыдущие адреса при переадресациях Prom. */
  addressHistory?: string[]
  status: string
  payer: string
  isAlternateRecipient?: boolean
  paymentAmount?: number
  paymentMethod?: string
  paymentStatus?: string
  /** Дата фактического получения заказа покупателем по данным маркетплейса. */
  receivedAt?: string
  /** Уже учтённые операции RozetkaPay, чтобы повторный импорт реестра не применял их повторно. */
  rozetkaPayOperationIds?: string[]
  hasWebsiteCommission?: boolean
  shippingSource?: 'manual' | 'seller-api' | 'prom-promo' | 'none'
  /** Последний статус, полученный из публичной tracking-ссылки перевозчика. */
  trackingStatus?: string
  trackingNormalizedStatus?: string
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
  extraExpenses?: number
  delivery: Delivery
}
