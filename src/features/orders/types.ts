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
  marketplaceProductKey?: string
  costManual?: boolean
  priceItemId?: string
  royaltyPercent?: number
  royaltyAmount?: number
  royaltyManual?: boolean
  returnedQuantity?: number
  returnedAt?: string
}

export type DeliveryCarrier = 'Новая почта' | 'Укрпочта' | 'RozetkaDelivery' | 'Meest'
export type ShipmentRelation = 'original' | 'redirect' | 'return' | 'replacement' | 'unknown'
export type ShipmentSource = 'marketplace' | 'carrier_api' | 'public_tracking' | 'manual'

export interface ShipmentHistoryEntry {
  ttn: string
  carrier: string
  relation: ShipmentRelation
  relatedTtn?: string
  city?: string
  address?: string
  branchNumber?: string
  locationCode?: string
  postalCode?: string
  source: ShipmentSource
  firstSeenAt: string
  lastSeenAt: string
}

export interface Delivery {
  carrier: DeliveryCarrier
  ttn: string
  /** Legacy: previous TTNs. Kept for backward compatibility; do not pair by index with addressHistory. */
  ttnHistory?: string[]
  /** Structured TTN/address snapshots for current delivery and all known changes. */
  shipmentHistory?: ShipmentHistoryEntry[]
  recipient: string
  recipientPhone: string
  city: string
  address: string
  /** Legacy: previous full addresses. Kept for backward compatibility; do not pair by index with ttnHistory. */
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
  /** Последний статус, полученный из tracking перевозчика. */
  trackingStatus?: string
  trackingNormalizedStatus?: string
  trackingLastCheckedAt?: string
  trackingStatusChangedAt?: string
  trackingDataChangedAt?: string
  trackingLastError?: string
  trackingDestinationCity?: string
  trackingDestinationAddress?: string
  trackingDestinationBranchNumber?: string
  trackingDestinationLocationCode?: string
  trackingDestinationPostalCode?: string
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
