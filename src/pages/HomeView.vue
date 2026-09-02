<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  onScopeDispose,
  ref,
  toRaw,
  useTemplateRef,
  watch,
} from 'vue'
import type { RealtimeChannel, User } from '@supabase/supabase-js'
import { useRoute, useRouter } from 'vue-router'
import {
  useClipboard,
  useDocumentVisibility,
  useEventListener,
  useFileDialog,
  useOnline,
  useSessionStorage,
  useTimeoutFn,
  useWindowScroll,
} from '@vueuse/core'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ArrowUp,
  Copy,
  ExternalLink,
  Globe2,
  Link2,
  LogOut,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Truck,
  Upload,
  X,
} from '@lucide/vue'
import * as XLSX from 'xlsx'

import { demoOrders } from '@/features/orders/demoOrders'
import {
  deliveryTtnForClipboard,
  displayCarrier,
  displayDeliveryAddress,
  formatDeliveryTtn,
  formatUkrainianPhone,
  orderBusinessPlatform,
} from '@/features/orders/display'
import type {
  Delivery,
  Order,
  OrderProduct,
  Platform,
  ShipmentHistoryEntry,
  ShipmentRelation,
} from '@/features/orders/types'
import { supabase } from '@/lib/supabase'
import PlatformLogo from '@/components/ui/PlatformLogo.vue'
import CarrierLogo from '@/components/ui/CarrierLogo.vue'
import { reapplyRegistryPreview } from '@/features/orders/registry-preview'
import PrintRegistry from '@/features/orders/PrintRegistry.vue'

const storageKey = 'specmarket-crm-demo-orders'
const registryDraftNavigationStorageKey = 'specmarket-crm-registry-navigation'
const knownRemoteOrderIdsStorageKey = 'specmarket-crm-known-remote-orders'
const unopenedNewOrdersStorageKey = 'specmarket-crm-unopened-new-orders'
const copiedSpreadsheetOrderIdsStorageKey = 'specmarket-crm-copied-excel-orders'
const preferredOrderListMonthPeriodStorageKey = 'specmarket-crm-order-list-month-period'
const route = useRoute()
const router = useRouter()
const orderDialog = useTemplateRef<HTMLDialogElement>('orderDialog')
const { copy, copied, isSupported: isClipboardSupported } = useClipboard({ copiedDuring: 0 })
const {
  files: promRegistryFiles,
  open: openPromRegistryFilePicker,
  reset: resetPromRegistryFilePicker,
} = useFileDialog({
  accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  multiple: false,
})
const documentVisibility = useDocumentVisibility()
const isOnline = useOnline()
const { y: windowScrollY } = useWindowScroll()
const registryDraftNavigation = useSessionStorage<string | null>(
  registryDraftNavigationStorageKey,
  null,
)
const searchQuery = ref('')
const platformFilter = ref<'all' | Platform>('all')
type PlatformSummaryPeriod = 'week' | 'decade' | 'month' | 'last30' | 'custom'
type OrderListPeriod = PlatformSummaryPeriod | 'day'
type PreferredOrderListMonthPeriod = Extract<OrderListPeriod, 'month' | 'last30'>

function loadPreferredOrderListMonthPeriod(): PreferredOrderListMonthPeriod {
  return window.localStorage.getItem(preferredOrderListMonthPeriodStorageKey) === 'last30'
    ? 'last30'
    : 'month'
}

const platformSummaryPeriod = ref<PlatformSummaryPeriod>('month')
const platformSummaryFrom = ref('')
const platformSummaryTo = ref('')
const orderListPeriod = ref<OrderListPeriod>(loadPreferredOrderListMonthPeriod())
const orderListFrom = ref('')
const orderListTo = ref('')
const orderListDate = ref('')
watch(orderListPeriod, (period) => {
  if (period === 'month' || period === 'last30') {
    window.localStorage.setItem(preferredOrderListMonthPeriodStorageKey, period)
  }
})
const isComparingPreviousPeriod = ref(false)
const isPlatformSummaryExpanded = ref(false)
const isShowingCancelledAndReturned = ref(false)
const isShowingUnpaidOnly = ref(false)
const expandedOrderId = ref<string | number | null>(null)
const deletingOrderId = ref<string | number | null>(null)
const user = ref<User | null>(null)
const email = ref('')
const password = ref('')
const authError = ref('')
const isSigningIn = ref(false)
const showPassword = ref(false)
const editingOrderCell = ref<string | null>(null)
const editingOrderValue = ref<Record<string, string>>({})
const editingManualOrderId = ref<string | number | null>(null)
const isSavingOrderDraft = ref(false)
const orderDraftError = ref('')
const commentEditorOrderId = ref<string | number | null>(null)
const editingInternalCommentOrderId = ref<string | number | null>(null)
const editingInternalCommentValue = ref<Record<string, string>>({})
const usdRate = ref(45.2)
const linkedPriceProductKeys = ref(new Set<string>())
const isSyncingEpicentr = ref(false)
const isSyncingProm = ref(false)
const isSyncingKasta = ref(false)
const isSyncingAllPlatforms = ref(false)
const isSyncingDelivery = ref(false)
const isMarketplaceSyncBusy = computed(
  () =>
    isSyncingAllPlatforms.value ||
    isSyncingEpicentr.value ||
    isSyncingProm.value ||
    isSyncingKasta.value,
)
const isApplyingPromRegistry = ref(false)
const syncEpicentrMessage = ref('')
const syncNoticeVisible = ref(false)
const inlineActionNotice = ref<{ key: string; text: string } | null>(null)
let inlineActionNoticeKey = ''
const { start: restartInlineActionNoticeTimer } = useTimeoutFn(
  () => {
    if (inlineActionNotice.value?.key === inlineActionNoticeKey) inlineActionNotice.value = null
  },
  1800,
  { immediate: false },
)

function showInlineActionNotice(key: string, text: string) {
  inlineActionNotice.value = { key, text }
  inlineActionNoticeKey = key
  restartInlineActionNoticeTimer()
}
type PromRegistryEntry = {
  orderNumber: string
  paymentAmount: number
  acquiring: number
  hasAcquiring: boolean
  operations?: Array<{
    id: string
    paymentAmount: number
    acquiring: number
    isReversal: boolean
  }>
}
type RegistrySource = 'RozetkaPay' | 'NovaPay' | 'Kasta' | 'Укрпочта' | 'Meest Express'
type RegistryKeyType = 'orderNumber' | 'ttn'
type RegistryDraftNavigation = {
  entries: PromRegistryEntry[]
  fileName: string
  source: RegistrySource
  keyType: RegistryKeyType
}
type UnopenedNewOrder = {
  remoteId: string
  orderId: string
  platform: Platform
}
type OrderItemReturn = {
  order_id: string
  item_position: number
  product_name: string
  returned_quantity: number
  returned_at: string | null
}
const promRegistryEntries = ref<PromRegistryEntry[]>([])
const promRegistryFileName = ref('')
const promRegistryError = ref('')
const isPromRegistryDraft = ref(false)
const registrySource = ref<RegistrySource | null>(null)
const registryKeyType = ref<RegistryKeyType>('orderNumber')
const promRegistryOriginalFinancials = new Map<
  string | number,
  { paymentAmount: number; acquiring: number; acquiringPercent: number | undefined }
>()
const promRegistryExpectedFinancials = new Map<
  string | number,
  { paymentAmount: number; acquiring: number }
>()
const promRegistryPendingOperationIds = new Map<string | number, string[]>()
const promRegistryNewFields = ref(new Set<string>())
const promRegistryMismatchedFields = ref(new Set<string>())
const promRegistryExistingFinancials = ref({ complete: 0, partial: 0 })
const expandedRegistryOrderIds = ref<Array<string | number>>([])
const printRegistryMode = ref<'draft' | 'history' | null>(null)
const printRegistryOrderIds = ref<Array<string | number>>([])
const isUpdatingPrintRegistry = ref(false)
const isPreparingPrintRegistry = ref(false)
const returnEditorOrderId = ref<string | number | null>(null)
const returnDraftQuantities = ref<Record<string, string>>({})
const returnDraftDate = ref(new Date().toISOString().slice(0, 10))
const isSavingReturn = ref(false)
let persistenceQueue: Promise<void> = Promise.resolve()
const pendingLocalOrderSaves = new Map<string, number>()
const deferredRemoteOrderIds = new Set<string>()
const { start: restartSyncNoticeCleanupTimer, stop: stopSyncNoticeCleanupTimer } = useTimeoutFn(
  () => {
    syncEpicentrMessage.value = ''
  },
  500,
  { immediate: false },
)
const { start: restartSyncNoticeTimer, stop: stopSyncNoticeTimer } = useTimeoutFn(
  () => {
    syncNoticeVisible.value = false
    restartSyncNoticeCleanupTimer()
  },
  30000,
  { immediate: false },
)
let ordersRealtimeChannel: RealtimeChannel | undefined
let realtimeRefreshTimer: ReturnType<typeof window.setTimeout> | undefined
let realtimeReconnectTimer: ReturnType<typeof window.setTimeout> | undefined
let reconciliationTimer: ReturnType<typeof window.setTimeout> | undefined
let isReconciliationRunning = false
let lastReconciliationAt = 0
const pendingRemoteOrderIds = new Set<string>()
const pendingNewOrderIds = new Set<string>()
const newOrderToasts = ref<Array<{ id: number; text: string }>>([])
let nextNewOrderToastId = 0
let audioContext: AudioContext | undefined
const stopAudioUnlockListeners = ['pointerdown', 'click', 'keydown'].map((event) =>
  useEventListener(window, event, unlockNewOrderSound),
)

function dismissNewOrderToastsOnPointerDown() {
  if (newOrderToasts.value.length) newOrderToasts.value = []
}

const ordersRealtimeSubscribed = ref(false)
let isAutomaticOrdersRefreshActive = false
let isRealtimeRestarting = false
const remoteOrderVersions = new Map<string, string>()
const isGuest = computed(() => user.value?.email?.toLowerCase() === 'guest@gmail.com')

function showSyncMessage(message: string) {
  stopSyncNoticeTimer()
  stopSyncNoticeCleanupTimer()
  syncEpicentrMessage.value = message
  syncNoticeVisible.value = true
  restartSyncNoticeTimer()
}

function showSyncError(message: string) {
  stopSyncNoticeTimer()
  stopSyncNoticeCleanupTimer()
  syncEpicentrMessage.value = message
  syncNoticeVisible.value = true
}

// Ручное изменение поля сохраняется асинхронно. Синхронизация не должна
// читать старую версию заказа из базы и затем вернуть в него нули.
async function waitForPendingSaves(): Promise<boolean> {
  try {
    await persistenceQueue
    return true
  } catch (error) {
    console.error('Не удалось сохранить изменения перед синхронизацией:', error)
    showSyncError('Не удалось сохранить изменения. Синхронизация не запускалась.')
    return false
  }
}

const platformOptions: Platform[] = ['Пром', 'Эпицентр', 'Каста', 'Р/С', 'Сайт']
const newOrderNotificationPlatforms: Platform[] = ['Пром', 'Эпицентр', 'Каста']

function readStoredStringArray(key: string) {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? '[]')
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

function readStoredUnopenedOrders() {
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(unopenedNewOrdersStorageKey) ?? '[]',
    )
    if (!Array.isArray(value)) return []
    return value.filter((item): item is UnopenedNewOrder => {
      if (!item || typeof item !== 'object') return false
      const entry = item as Partial<UnopenedNewOrder>
      return (
        typeof entry.remoteId === 'string' &&
        typeof entry.orderId === 'string' &&
        platformOptions.includes(entry.platform as Platform)
      )
    })
  } catch {
    return []
  }
}

let hasRemoteOrderBaseline = window.localStorage.getItem(knownRemoteOrderIdsStorageKey) !== null
let knownRemoteOrderIds = new Set(readStoredStringArray(knownRemoteOrderIdsStorageKey))
const unopenedNewOrders = ref<UnopenedNewOrder[]>(readStoredUnopenedOrders())
const copiedSpreadsheetOrderIds = ref(
  new Set(readStoredStringArray(copiedSpreadsheetOrderIdsStorageKey)),
)

function isSpreadsheetOrderCopied(order: Order) {
  return copiedSpreadsheetOrderIds.value.has(String(order.id))
}

function markSpreadsheetOrderCopied(order: Order) {
  const orderId = String(order.id)
  if (copiedSpreadsheetOrderIds.value.has(orderId)) return

  copiedSpreadsheetOrderIds.value = new Set([...copiedSpreadsheetOrderIds.value, orderId])
  window.localStorage.setItem(
    copiedSpreadsheetOrderIdsStorageKey,
    JSON.stringify([...copiedSpreadsheetOrderIds.value]),
  )
}

function persistNewOrderTracking() {
  window.localStorage.setItem(
    knownRemoteOrderIdsStorageKey,
    JSON.stringify([...knownRemoteOrderIds]),
  )
  window.localStorage.setItem(unopenedNewOrdersStorageKey, JSON.stringify(unopenedNewOrders.value))
}

function registerRemoteOrders(
  remoteOrders: Array<{ remoteId: string; orderId: string; platform: Platform }>,
) {
  const currentRemoteIds = new Set(remoteOrders.map((order) => order.remoteId))
  const pendingByRemoteId = new Map(
    unopenedNewOrders.value.map((order) => [order.remoteId, order] as const),
  )
  if (hasRemoteOrderBaseline) {
    for (const order of remoteOrders) {
      if (
        !knownRemoteOrderIds.has(order.remoteId) &&
        newOrderNotificationPlatforms.includes(order.platform)
      )
        pendingByRemoteId.set(order.remoteId, order)
    }
  }
  unopenedNewOrders.value = [...pendingByRemoteId.values()].filter(
    (order) =>
      currentRemoteIds.has(order.remoteId) &&
      newOrderNotificationPlatforms.includes(order.platform),
  )
  knownRemoteOrderIds = currentRemoteIds
  hasRemoteOrderBaseline = true
  persistNewOrderTracking()
}

function registerRefreshedRemoteOrders(
  remoteOrders: Array<{ remoteId: string; orderId: string; platform: Platform }>,
) {
  const pendingByRemoteId = new Map(
    unopenedNewOrders.value.map((order) => [order.remoteId, order] as const),
  )
  for (const order of remoteOrders) {
    if (
      hasRemoteOrderBaseline &&
      !knownRemoteOrderIds.has(order.remoteId) &&
      newOrderNotificationPlatforms.includes(order.platform)
    )
      pendingByRemoteId.set(order.remoteId, order)
    knownRemoteOrderIds.add(order.remoteId)
  }
  unopenedNewOrders.value = [...pendingByRemoteId.values()]
  persistNewOrderTracking()
}

function unregisterRemoteOrder(remoteId: string) {
  knownRemoteOrderIds.delete(remoteId)
  unopenedNewOrders.value = unopenedNewOrders.value.filter((order) => order.remoteId !== remoteId)
  remoteOrderVersions.delete(remoteId)
  persistNewOrderTracking()
}

function isUnopenedNewOrder(order: Order) {
  return (
    newOrderNotificationPlatforms.includes(order.platform) &&
    !(order.delivery.ttn ?? '').trim() &&
    !isCancelledOrReturned(order)
  )
}
const carrierOptions: Delivery['carrier'][] = [
  'Новая почта',
  'Укрпочта',
  'RozetkaDelivery',
  'Meest',
]
const statusOptions: Record<Platform, string[]> = {
  Пром: ['Новий', 'Прийнято', 'Виконано', 'Оплачено', 'Скасовано'],
  Эпицентр: [
    'Новий',
    'Підтверджено продавцем',
    'Підтверджено',
    'Відправлено',
    'Готово до видачі',
    'Завершено',
    'Закрито',
    'Скасовано',
    'Повернено',
    'Запит на повернення',
    'Скасовано продавцем',
  ],
  Каста: ['Новый', 'Принято', 'В дороге', 'Закрыт', 'Скасовано', 'Возврат'],
  'Р/С': ['В дороге', 'Закрыт', 'Возврат'],
  Сайт: ['В дороге', 'Закрыт', 'Возврат'],
}

const storedOrders = window.localStorage.getItem(storageKey)
const orders = ref<Order[]>(
  storedOrders
    ? (JSON.parse(storedOrders) as Order[]).map((order) => ({
        ...order,
        delivery: {
          ...order.delivery,
          recipient: order.delivery.recipient || order.customer,
          recipientPhone: order.delivery.recipientPhone || order.phone,
        },
      }))
    : demoOrders,
)

const todayKey = () => new Intl.DateTimeFormat('uk-UA').format(new Date())
const currentTime = () =>
  new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit', hour12: false }).format(
    new Date(),
  )
const orderDraft = ref(createOrderDraft())

function startOfLocalDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

function inputDate(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseInputDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day)
}

function parseOrderDate(value: string) {
  const [day, month, year] = value.split('.').map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day)
}

function shiftDateByMonths(value: Date, months: number) {
  const targetMonth = value.getMonth() + months
  const lastTargetDay = new Date(value.getFullYear(), targetMonth + 1, 0).getDate()
  return new Date(value.getFullYear(), targetMonth, Math.min(value.getDate(), lastTargetDay))
}

function formatShortDate(value: Date) {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(value)
}

const defaultPlatformSummaryDate = startOfLocalDay(new Date())
platformSummaryFrom.value = inputDate(
  new Date(defaultPlatformSummaryDate.getFullYear(), defaultPlatformSummaryDate.getMonth(), 1),
)
platformSummaryTo.value = inputDate(defaultPlatformSummaryDate)
const defaultOrderListDate = new Date(defaultPlatformSummaryDate)
defaultOrderListDate.setDate(defaultOrderListDate.getDate() - 1)
orderListFrom.value = inputDate(defaultOrderListDate)
orderListTo.value = inputDate(defaultOrderListDate)
orderListDate.value = inputDate(defaultOrderListDate)

const getOrderAmount = (order: Order) =>
  order.products.reduce((sum, product) => sum + product.price * product.quantity, 0)
const getOrderPreviewImage = (order: Order) => order.products[0]?.imageUrl
const getProductAmount = (product: OrderProduct) => product.price * product.quantity
const getRemainingQuantity = (product: OrderProduct) =>
  Math.max(0, product.quantity - (product.returnedQuantity ?? 0))
const getNetOrderAmount = (order: Order) =>
  order.products.reduce((sum, product) => sum + product.price * getRemainingQuantity(product), 0)
const getNetOrderCost = (order: Order) =>
  order.products.reduce((sum, product) => sum + product.cost * getRemainingQuantity(product), 0)
const getProductRoyalty = (order: Order, product: OrderProduct) => {
  const percent = product.royaltyPercent ?? (order.platform === 'Каста' ? 22 : 0)
  return product.royaltyAmount ?? product.price * product.quantity * (percent / 100)
}
const getNetProductRoyalty = (order: Order, product: OrderProduct) => {
  const remainingQuantity = getRemainingQuantity(product)
  if (remainingQuantity === product.quantity) return getProductRoyalty(order, product)
  if (product.quantity <= 0) return 0
  if (product.royaltyAmount !== undefined)
    return product.royaltyAmount * (remainingQuantity / product.quantity)
  const percent = product.royaltyPercent ?? (order.platform === 'Каста' ? 22 : 0)
  return product.price * remainingQuantity * (percent / 100)
}
const getNetRoyalty = (order: Order) =>
  order.products.reduce((sum, product) => sum + getNetProductRoyalty(order, product), 0)
const hasAcceptedReturn = (order: Order) =>
  order.products.some((product) => (product.returnedQuantity ?? 0) > 0)
const isFullyAcceptedReturn = (order: Order) =>
  hasAcceptedReturn(order) && getNetOrderAmount(order) === 0
const getActualRevenue = (order: Order) => {
  const paymentAmount = order.paymentAmount ?? 0
  if (order.platform !== 'Каста' || !hasAcceptedReturn(order)) return paymentAmount
  const returnedAmount = getOrderAmount(order) - getNetOrderAmount(order)
  return Math.max(0, paymentAmount - returnedAmount)
}
const getPlannedProfit = (order: Order) =>
  isFullyAcceptedReturn(order)
    ? 0
    : getNetOrderAmount(order) * 0.983 -
      getNetOrderCost(order) -
      getNetRoyalty(order) -
      order.shipping -
      (order.extraExpenses ?? 0)
// Обычно фактическая прибыль появляется после внесения оплаты. Полностью
// принятый возврат — исключение: его отрицательный результат уже состоялся,
// даже если итоговая сумма оплаты стала нулевой.
const isPaid = (order: Order) => (order.paymentAmount ?? 0) > 0
const hasActualFinancialResult = (order: Order) => isPaid(order) || isFullyAcceptedReturn(order)
const getActualProfit = (order: Order) =>
  getActualRevenue(order) -
  getNetOrderCost(order) -
  getNetRoyalty(order) -
  order.shipping -
  order.acquiring -
  (order.extraExpenses ?? 0)
const formatMoney = (value: number) => {
  const fractionDigits = Number.isInteger(value) ? 0 : 2
  return (
    new Intl.NumberFormat('uk-UA', {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(value) + ' ₴'
  )
}
const formatNumber = (value: number) => {
  const fractionDigits = Number.isInteger(value) ? 0 : 2
  return new Intl.NumberFormat('uk-UA', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value)
}
const formatProfitPercent = (profit: number, amount: number) => {
  const value = amount === 0 ? 0 : (profit / amount) * 100
  return (
    new Intl.NumberFormat('uk-UA', {
      minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(value) + '%'
  )
}
const formatOrderNumber = (value: number | undefined) => {
  if (value === undefined) return ''
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace('.', ',')
}

function normalizePromRegistryOrderNumber(value: unknown) {
  return String(value ?? '').replace(/\D/g, '')
}

function normalizeRegistryKey(value: unknown, preserveLetters = registrySource.value === 'Kasta') {
  if (preserveLetters)
    return String(value ?? '')
      .replace(/\s/g, '')
      .toUpperCase()
  return normalizePromRegistryOrderNumber(value)
}

const registrySourceLabel = computed(() => registrySource.value ?? 'реестр')

function registryKeyForOrder(order: Order) {
  return registryKeyType.value === 'ttn'
    ? normalizeRegistryKey(order.delivery.ttn)
    : normalizeRegistryKey(order.displayNumber ?? order.id)
}

function getRegistryPaymentAmount(order: Order, entry: PromRegistryEntry) {
  const expected = promRegistryExpectedFinancials.get(order.id)
  if (expected) return expected.paymentAmount
  return registrySource.value === 'Kasta' ? getOrderAmount(order) : entry.paymentAmount
}

function getRegistryAcquiring(order: Order, entry: PromRegistryEntry) {
  return promRegistryExpectedFinancials.get(order.id)?.acquiring ?? entry.acquiring
}

function parsePromRegistryAmount(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const normalized = String(value ?? '')
    .replace(/\s/g, '')
    .replace(',', '.')
    .replace(/[^\d.-]/g, '')
  const amount = Number(normalized)
  return Number.isFinite(amount) ? amount : 0
}

function normalizePromRegistryHeader(value: unknown) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('uk-UA')
}

function rowsFromPromRegistrySheet(sheet: XLSX.WorkSheet) {
  const rows: unknown[][] = []
  for (const [address, cell] of Object.entries(sheet)) {
    if (address.startsWith('!')) continue
    const position = XLSX.utils.decode_cell(address)
    const row = (rows[position.r] ??= [])
    row[position.c] = cell.v
  }
  return rows
}

function restorePromRegistryFinancials() {
  for (const order of orders.value) {
    const original = promRegistryOriginalFinancials.get(order.id)
    if (!original) continue
    order.paymentAmount = original.paymentAmount
    order.acquiring = original.acquiring
    order.acquiringPercent = original.acquiringPercent
  }
  promRegistryOriginalFinancials.clear()
  promRegistryExpectedFinancials.clear()
  promRegistryPendingOperationIds.clear()
  promRegistryNewFields.value = new Set()
  promRegistryMismatchedFields.value = new Set()
  promRegistryExistingFinancials.value = { complete: 0, partial: 0 }
}

function clearPromRegistry() {
  if (isPromRegistryDraft.value) restorePromRegistryFinancials()
  promRegistryExpectedFinancials.clear()
  promRegistryPendingOperationIds.clear()
  promRegistryEntries.value = []
  promRegistryFileName.value = ''
  promRegistryError.value = ''
  isPromRegistryDraft.value = false
  registrySource.value = null
  registryKeyType.value = 'orderNumber'
  expandedRegistryOrderIds.value = []
  expandedOrderId.value = null
  registryDraftNavigation.value = null
  resetPromRegistryFilePicker()
}

function saveRegistryDraftNavigation() {
  if (!isPromRegistryDraft.value || !registrySource.value) return
  const draft: RegistryDraftNavigation = {
    entries: promRegistryEntries.value,
    fileName: promRegistryFileName.value,
    source: registrySource.value,
    keyType: registryKeyType.value,
  }
  registryDraftNavigation.value = JSON.stringify(draft)
}

function restoreRegistryDraftNavigation() {
  const rawDraft = registryDraftNavigation.value
  if (!rawDraft) return
  try {
    const draft = JSON.parse(rawDraft) as Partial<RegistryDraftNavigation>
    if (!Array.isArray(draft.entries) || !draft.entries.length || !draft.source || !draft.keyType)
      return
    promRegistryEntries.value = draft.entries
    promRegistryFileName.value = draft.fileName ?? 'реестр'
    registrySource.value = draft.source
    registryKeyType.value = draft.keyType
    isPromRegistryDraft.value = true
    applyPromRegistryPreview(draft.entries)
  } catch {
    registryDraftNavigation.value = null
  }
}

function applyPromRegistryPreview(entries: PromRegistryEntry[]) {
  restorePromRegistryFinancials()
  const entriesByOrder = new Map(entries.map((entry) => [entry.orderNumber, entry]))
  const newFields = new Set<string>()
  const mismatchedFields = new Set<string>()
  let complete = 0
  let partial = 0
  for (const order of orders.value) {
    const entry = entriesByOrder.get(registryKeyForOrder(order))
    if (!entry) continue
    const financialEditKeys = [
      `${order.id}-payment-amount`,
      `${order.id}-acquiring-percent`,
      `${order.id}-acquiring`,
    ]
    for (const key of financialEditKeys) delete editingOrderValue.value[key]
    if (editingOrderCell.value && financialEditKeys.includes(editingOrderCell.value)) {
      editingOrderCell.value = null
    }
    promRegistryOriginalFinancials.set(order.id, {
      paymentAmount: order.paymentAmount ?? 0,
      acquiring: order.acquiring,
      acquiringPercent: order.acquiringPercent,
    })
    const hasPayment = (order.paymentAmount ?? 0) > 0
    const hasAcquiring = order.acquiring > 0
    if (hasPayment && (!entry.hasAcquiring || hasAcquiring)) complete += 1
    else if (hasPayment || hasAcquiring) partial += 1

    if (registrySource.value === 'RozetkaPay' && entry.operations?.length) {
      const processedOperationIds = new Set(order.delivery.rozetkaPayOperationIds ?? [])
      const pendingOperationIds: string[] = []
      const operations = entry.operations.filter(
        (operation) => !operation.id || !processedOperationIds.has(operation.id),
      )
      const regularOperations = operations.filter((operation) => !operation.isReversal)
      const reversalOperations = operations.filter((operation) => operation.isReversal)
      let paymentAmount = order.paymentAmount ?? 0
      let acquiring = order.acquiring
      let canApplyReversals = true

      if (regularOperations.length) {
        const registryPaymentAmount = regularOperations.reduce(
          (total, operation) => total + operation.paymentAmount,
          0,
        )
        const registryAcquiring = regularOperations.reduce(
          (total, operation) => total + operation.acquiring,
          0,
        )
        let regularOperationsMatch = true
        if (!hasPayment && registryPaymentAmount > 0) {
          paymentAmount = registryPaymentAmount
          newFields.add(`${order.id}-paymentAmount`)
        } else if (hasPayment && Math.abs(paymentAmount - registryPaymentAmount) > 0.01) {
          mismatchedFields.add(`${order.id}-paymentAmount`)
          regularOperationsMatch = false
          canApplyReversals = false
        }
        if (entry.hasAcquiring && !hasAcquiring && registryAcquiring > 0) {
          acquiring = registryAcquiring
          newFields.add(`${order.id}-acquiring`)
        } else if (
          entry.hasAcquiring &&
          hasAcquiring &&
          Math.abs(acquiring - registryAcquiring) > 0.01
        ) {
          mismatchedFields.add(`${order.id}-acquiring`)
          regularOperationsMatch = false
          canApplyReversals = false
        }
        if (regularOperationsMatch) {
          pendingOperationIds.push(
            ...regularOperations.map((operation) => operation.id).filter(Boolean),
          )
        }
      }

      for (const operation of canApplyReversals ? reversalOperations : []) {
        const nextPaymentAmount = paymentAmount + operation.paymentAmount
        const nextAcquiring = acquiring + operation.acquiring
        const paymentUnderflow = nextPaymentAmount < -0.01
        const acquiringUnderflow = entry.hasAcquiring && nextAcquiring < -0.01
        if (paymentUnderflow) mismatchedFields.add(`${order.id}-paymentAmount`)
        if (acquiringUnderflow) mismatchedFields.add(`${order.id}-acquiring`)
        if (paymentUnderflow || acquiringUnderflow) continue
        paymentAmount = Math.max(0, nextPaymentAmount)
        acquiring = Math.max(0, nextAcquiring)
        newFields.add(`${order.id}-paymentAmount`)
        if (entry.hasAcquiring) newFields.add(`${order.id}-acquiring`)
        if (operation.id) pendingOperationIds.push(operation.id)
      }

      order.paymentAmount = paymentAmount
      order.acquiring = acquiring
      if (entry.hasAcquiring) {
        const amount = getOrderAmount(order)
        order.acquiringPercent = amount === 0 ? 0 : (acquiring / amount) * 100
      }
      promRegistryExpectedFinancials.set(order.id, { paymentAmount, acquiring })
      if (pendingOperationIds.length) {
        promRegistryPendingOperationIds.set(order.id, [...new Set(pendingOperationIds)])
      }
      continue
    }

    const registryPaymentAmount = getRegistryPaymentAmount(order, entry)
    if (!hasPayment && registryPaymentAmount > 0) {
      order.paymentAmount = registryPaymentAmount
      newFields.add(`${order.id}-paymentAmount`)
    }
    if (hasPayment && Math.abs((order.paymentAmount ?? 0) - registryPaymentAmount) > 0.01) {
      mismatchedFields.add(`${order.id}-paymentAmount`)
    }
    if (entry.hasAcquiring && !hasAcquiring && entry.acquiring > 0) {
      order.acquiring = entry.acquiring
      const amount = getOrderAmount(order)
      order.acquiringPercent = amount === 0 ? 0 : (entry.acquiring / amount) * 100
      newFields.add(`${order.id}-acquiring`)
    }
    if (entry.hasAcquiring && hasAcquiring && Math.abs(order.acquiring - entry.acquiring) > 0.01) {
      mismatchedFields.add(`${order.id}-acquiring`)
    }
  }
  promRegistryNewFields.value = newFields
  promRegistryMismatchedFields.value = mismatchedFields
  promRegistryExistingFinancials.value = { complete, partial }
  expandedRegistryOrderIds.value = orders.value
    .filter((order) => entriesByOrder.has(registryKeyForOrder(order)))
    .map((order) => order.id)
}

function isPromRegistryNewField(order: Order, field: 'paymentAmount' | 'acquiring') {
  return isPromRegistryDraft.value && promRegistryNewFields.value.has(`${order.id}-${field}`)
}

function isPromRegistryFieldMismatch(order: Order, field: 'paymentAmount' | 'acquiring') {
  if (!isPromRegistryDraft.value) return false
  if (promRegistryMismatchedFields.value.has(`${order.id}-${field}`)) return true
  const entry = promRegistryEntriesByOrder.value.get(registryKeyForOrder(order))
  if (!entry) return false
  if (field === 'acquiring' && !entry.hasAcquiring) return false
  const actual = field === 'paymentAmount' ? (order.paymentAmount ?? 0) : order.acquiring
  const expected =
    field === 'paymentAmount'
      ? getRegistryPaymentAmount(order, entry)
      : getRegistryAcquiring(order, entry)
  return Math.abs(actual - expected) > 0.01
}

function promRegistryFieldClass(order: Order, field: 'paymentAmount' | 'acquiring') {
  if (isPromRegistryFieldMismatch(order, field)) {
    return 'border-amber-400 bg-amber-100 text-amber-950'
  }
  const entry = promRegistryEntriesByOrder.value.get(registryKeyForOrder(order))
  const actual = field === 'paymentAmount' ? (order.paymentAmount ?? 0) : order.acquiring
  const expected =
    field === 'paymentAmount' && entry
      ? getRegistryPaymentAmount(order, entry)
      : entry
        ? getRegistryAcquiring(order, entry)
        : 0
  if (
    isPromRegistryDraft.value &&
    isPromRegistryNewField(order, field) &&
    Math.abs(actual - expected) <= 0.01
  ) {
    return 'border-violet-300 bg-violet-100 text-violet-950'
  }
  return 'border-slate-200 text-slate-900'
}

async function handlePromRegistryFile(file: File) {
  if (isGuest.value) return
  promRegistryError.value = ''
  try {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const firstSheetName = workbook.SheetNames[0]
    const sheet = firstSheetName ? workbook.Sheets[firstSheetName] : undefined
    if (!sheet) throw new Error('В файле нет листа с реестром.')
    const rows = rowsFromPromRegistrySheet(sheet)
    const headerIndex = rows.findIndex((row) =>
      row?.some((cell) => {
        const headerName = normalizePromRegistryHeader(cell)
        return (
          headerName === '№ замовлення' ||
          headerName === '№ ен нп' ||
          headerName === 'замовлення' ||
          headerName === 'шкі' ||
          headerName === 'номер посилки'
        )
      }),
    )
    const header = rows[headerIndex]
    if (!header) throw new Error('Не найдена строка заголовков реестра.')
    const isNovaPay = header.some((cell) => normalizePromRegistryHeader(cell) === '№ ен нп')
    const isKasta = header.some((cell) => normalizePromRegistryHeader(cell) === 'замовлення')
    const isKastaFactoring =
      isKasta &&
      header.some(
        (cell) => normalizePromRegistryHeader(cell) === 'комісія за факторинг (довідково)',
      )
    const isUkrposhta = header.some((cell) => normalizePromRegistryHeader(cell) === 'шкі')
    const isMeest = header.some((cell) => normalizePromRegistryHeader(cell) === 'номер посилки')
    const source: RegistrySource = isNovaPay
      ? 'NovaPay'
      : isKasta
        ? 'Kasta'
        : isUkrposhta
          ? 'Укрпочта'
          : isMeest
            ? 'Meest Express'
            : 'RozetkaPay'
    const keyType: RegistryKeyType = isNovaPay || isUkrposhta || isMeest ? 'ttn' : 'orderNumber'
    const keyColumn = header.findIndex((cell) =>
      isNovaPay
        ? normalizePromRegistryHeader(cell) === '№ ен нп'
        : isKasta
          ? normalizePromRegistryHeader(cell) === 'замовлення'
          : isUkrposhta
            ? normalizePromRegistryHeader(cell) === 'шкі'
            : isMeest
              ? normalizePromRegistryHeader(cell) === 'номер посилки'
              : normalizePromRegistryHeader(cell) === '№ замовлення',
    )
    const paymentColumn = isKasta
      ? -1
      : header.findIndex((cell) =>
          isNovaPay
            ? ['сума прийнятих коштів', 'сума принятих коштів'].includes(
                normalizePromRegistryHeader(cell),
              )
            : isUkrposhta
              ? normalizePromRegistryHeader(cell) === 'сума, грн.'
              : isMeest
                ? normalizePromRegistryHeader(cell) === 'cod оплачено'
                : normalizePromRegistryHeader(cell) === 'сума платежу',
        )
    const acquiringColumn =
      isUkrposhta || isMeest
        ? -1
        : header.findIndex((cell) =>
            isNovaPay
              ? normalizePromRegistryHeader(cell) === 'сума утриманої винагороди'
              : isKasta
                ? normalizePromRegistryHeader(cell) ===
                  (isKastaFactoring ? 'комісія за факторинг (довідково)' : 'комісія')
                : normalizePromRegistryHeader(cell) === 'сума комісії з отримувача',
          )
    const operationIdColumn =
      source === 'RozetkaPay'
        ? header.findIndex(
            (cell) =>
              normalizePromRegistryHeader(cell) === 'унікальний номер фінансової операції fc id',
          )
        : -1
    const paymentTypeColumn =
      source === 'RozetkaPay'
        ? header.findIndex((cell) => normalizePromRegistryHeader(cell) === 'тип оплати')
        : -1
    if (
      keyColumn < 0 ||
      (!isUkrposhta && !isMeest && acquiringColumn < 0) ||
      (!isKasta && paymentColumn < 0)
    ) {
      throw new Error(`В реестре ${source} не найдены нужные колонки.`)
    }
    const entriesByOrder = new Map<string, PromRegistryEntry>()
    for (const row of rows.slice(headerIndex + 1)) {
      if (!row) continue
      const orderNumber = normalizeRegistryKey(row[keyColumn], isKasta)
      if (!orderNumber) continue
      if ((isNovaPay || isUkrposhta || isMeest) && orderNumber.length < 10) continue
      const entry = entriesByOrder.get(orderNumber) ?? {
        orderNumber,
        paymentAmount: 0,
        acquiring: 0,
        hasAcquiring: !isUkrposhta && !isMeest,
        operations: source === 'RozetkaPay' ? [] : undefined,
      }
      const paymentAmount = isKasta ? 0 : parsePromRegistryAmount(row[paymentColumn])
      if (!isKasta) entry.paymentAmount += paymentAmount
      if (!isUkrposhta && !isMeest) {
        const rawAcquiring = parsePromRegistryAmount(row[acquiringColumn])
        if (source === 'RozetkaPay') {
          const acquiring = -rawAcquiring
          const paymentType =
            paymentTypeColumn >= 0
              ? String(row[paymentTypeColumn] ?? '')
                  .trim()
                  .toLocaleLowerCase('uk-UA')
              : ''
          const isReversal =
            paymentAmount < 0 || rawAcquiring > 0 || /повер|refund|return/.test(paymentType)
          const operationId =
            operationIdColumn >= 0 ? String(row[operationIdColumn] ?? '').trim() : ''
          if (isReversal && !operationId) {
            throw new Error(
              `Для возврата RozetkaPay по заказу ${orderNumber} не найден FC ID. Без него сторнирование нельзя безопасно применить повторно.`,
            )
          }
          entry.acquiring += acquiring
          entry.operations?.push({
            id: operationId,
            paymentAmount,
            acquiring,
            isReversal,
          })
        } else {
          entry.acquiring += Math.abs(rawAcquiring)
        }
      }
      entriesByOrder.set(orderNumber, entry)
    }
    const entries = [...entriesByOrder.values()]
    if (!entries.length) throw new Error('В реестре не найдены строки платежей.')
    clearPromRegistry()
    promRegistryEntries.value = entries
    promRegistryFileName.value = file.name
    registrySource.value = source
    registryKeyType.value = keyType
    isPromRegistryDraft.value = true
    platformFilter.value = 'all'
    isShowingCancelledAndReturned.value = false
    await persistenceQueue
    await reconcileRemoteOrders(true)
    applyPromRegistryPreview(entries)
    saveRegistryDraftNavigation()
  } catch (error) {
    promRegistryError.value =
      error instanceof Error ? error.message : 'Не удалось прочитать реестр.'
  }
}

watch(promRegistryFiles, (files) => {
  const file = files?.[0]
  if (file) void handlePromRegistryFile(file)
})

async function confirmPromRegistryDistribution() {
  if (isGuest.value || !isPromRegistryDraft.value || isApplyingPromRegistry.value) return
  const matchedOrders = promRegistryOrders.value
  if (!matchedOrders.length) {
    promRegistryError.value = 'В CRM не найдены заказы из этого реестра.'
    return
  }
  if (
    !window.confirm(
      `Разнести оплаты и эквайринг из реестра ${registrySourceLabel.value} по ${matchedOrders.length} заказам? Это запишет значения в общую CRM.`,
    )
  )
    return
  isApplyingPromRegistry.value = true
  const previousOperationIds = new Map<string | number, string[] | undefined>()
  try {
    for (const order of matchedOrders) {
      const pendingOperationIds = promRegistryPendingOperationIds.get(order.id)
      if (!pendingOperationIds?.length) continue
      previousOperationIds.set(order.id, order.delivery.rozetkaPayOperationIds)
      order.delivery.rozetkaPayOperationIds = [
        ...new Set([...(order.delivery.rozetkaPayOperationIds ?? []), ...pendingOperationIds]),
      ]
    }
    isPromRegistryDraft.value = false
    await persistOrdersNow(matchedOrders)
    promRegistryOriginalFinancials.clear()
    promRegistryNewFields.value = new Set()
    promRegistryMismatchedFields.value = new Set()
    promRegistryExistingFinancials.value = { complete: 0, partial: 0 }
    clearPromRegistry()
    showSyncMessage(`Разнесено оплат: ${matchedOrders.length}.`)
  } catch (error) {
    isPromRegistryDraft.value = true
    for (const order of matchedOrders) {
      if (!previousOperationIds.has(order.id)) continue
      const previousIds = previousOperationIds.get(order.id)
      if (previousIds?.length) order.delivery.rozetkaPayOperationIds = previousIds
      else delete order.delivery.rozetkaPayOperationIds
    }
    promRegistryError.value =
      error instanceof Error ? error.message : 'Не удалось сохранить разнесение.'
  } finally {
    isApplyingPromRegistry.value = false
  }
}

function isCancelledOrReturned(order: Order) {
  return /скас|отмен|cancel|повер|возврат|return|refund/.test(
    displayOrderStatus(order.status).toLowerCase(),
  )
}

function isCancelledOrder(order: Order) {
  return /скас|отмен|cancel/.test(displayOrderStatus(order.status).toLowerCase())
}

const reportOrders = computed(() =>
  orders.value.filter((order) => {
    if (!order.delivery.ttn.trim()) return false
    if (!isCancelledOrReturned(order)) return true
    return order.platform === 'Каста' && Boolean(order.delivery.receivedAt)
  }),
)
const unpaidShipmentAccountingStart = new Date(2026, 7, 1)
const unpaidShipmentAmount = computed(() =>
  orders.value
    .filter((order) => {
      const orderDate = parseOrderDate(order.date)
      if (orderDate === null || orderDate < unpaidShipmentAccountingStart) return false
      return Boolean(order.delivery.ttn.trim()) && !isPaid(order) && !isCancelledOrder(order)
    })
    .reduce((total, order) => total + getNetOrderAmount(order), 0),
)
const printRegistryOrders = computed(() => {
  if (printRegistryMode.value === 'history')
    return orders.value.filter((order) => Boolean(order.delivery.printedAt))
  const orderIds = new Set(printRegistryOrderIds.value.map(String))
  return orders.value.filter((order) => orderIds.has(String(order.id))).reverse()
})
const ordersForToday = computed(() =>
  reportOrders.value.filter((order) => order.date === todayKey()),
)
const platformSummaryRange = computed(() => {
  const today = startOfLocalDay(new Date())
  if (platformSummaryPeriod.value === 'week') {
    const dayFromMonday = (today.getDay() + 6) % 7
    const from = new Date(today)
    from.setDate(today.getDate() - dayFromMonday)
    const to = new Date(from)
    to.setDate(from.getDate() + 6)
    return { from, to }
  }
  if (platformSummaryPeriod.value === 'decade') {
    const startDay = today.getDate() <= 10 ? 1 : today.getDate() <= 20 ? 11 : 21
    const from = new Date(today.getFullYear(), today.getMonth(), startDay)
    const to = new Date(
      today.getFullYear(),
      today.getMonth(),
      startDay === 21
        ? new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
        : startDay + 9,
    )
    return { from, to }
  }
  if (platformSummaryPeriod.value === 'last30') {
    const from = new Date(today)
    from.setDate(today.getDate() - 29)
    return { from, to: today }
  }
  if (platformSummaryPeriod.value === 'custom') {
    const first = parseInputDate(platformSummaryFrom.value) ?? today
    const second = parseInputDate(platformSummaryTo.value) ?? first
    return first <= second ? { from: first, to: second } : { from: second, to: first }
  }
  return {
    from: new Date(today.getFullYear(), today.getMonth(), 1),
    to: new Date(today.getFullYear(), today.getMonth() + 1, 0),
  }
})
const ordersForPlatformSummary = computed(() => {
  const { from, to } = platformSummaryRange.value
  return reportOrders.value.filter((order) => {
    const date = parseOrderDate(order.date)
    return date !== null && date >= from && date <= to
  })
})
const orderListRange = computed(() => {
  const today = startOfLocalDay(new Date())
  if (orderListPeriod.value === 'day') {
    const selectedDate = parseInputDate(orderListDate.value) ?? today
    return { from: selectedDate, to: selectedDate }
  }
  if (orderListPeriod.value === 'week') {
    const from = new Date(today)
    from.setDate(today.getDate() - ((today.getDay() + 6) % 7))
    return { from, to: today }
  }
  if (orderListPeriod.value === 'decade') {
    const startDay = today.getDate() <= 10 ? 1 : today.getDate() <= 20 ? 11 : 21
    return { from: new Date(today.getFullYear(), today.getMonth(), startDay), to: today }
  }
  if (orderListPeriod.value === 'last30') {
    const from = new Date(today)
    from.setDate(today.getDate() - 29)
    return { from, to: today }
  }
  if (orderListPeriod.value === 'custom') {
    const first = parseInputDate(orderListFrom.value) ?? today
    const second = parseInputDate(orderListTo.value) ?? first
    return first <= second ? { from: first, to: second } : { from: second, to: first }
  }
  return {
    from: new Date(today.getFullYear(), today.getMonth(), 1),
    to: today,
  }
})
const ordersForSelectedPeriod = computed(() => {
  const { from, to } = orderListRange.value
  return reportOrders.value.filter((order) => {
    const date = parseOrderDate(order.date)
    return date !== null && date >= from && date <= to
  })
})
const previousOrderListRange = computed(() => ({
  from: shiftDateByMonths(orderListRange.value.from, -1),
  to: shiftDateByMonths(orderListRange.value.to, -1),
}))
function shiftOrderListDate(days: number) {
  const fallback = startOfLocalDay(new Date())
  fallback.setDate(fallback.getDate() - 1)
  const selectedDate = parseInputDate(orderListDate.value) ?? fallback
  const shiftedDate = new Date(selectedDate)
  shiftedDate.setDate(shiftedDate.getDate() + days)
  orderListDate.value = inputDate(shiftedDate)
}

function showTodayInOrderList() {
  orderListDate.value = inputDate(startOfLocalDay(new Date()))
}
const previousOrderListRangeLabel = computed(
  () =>
    `${formatShortDate(previousOrderListRange.value.from)}–${formatShortDate(previousOrderListRange.value.to)}`,
)
const ordersForPreviousPeriod = computed(() => {
  const { from, to } = previousOrderListRange.value
  return reportOrders.value.filter((order) => {
    const date = parseOrderDate(order.date)
    return date !== null && date >= from && date <= to
  })
})
const orderListPeriodLabel = computed(() => {
  if (orderListPeriod.value === 'day') {
    return new Intl.DateTimeFormat('ru-RU').format(orderListRange.value.from)
  }
  if (orderListPeriod.value !== 'custom') {
    return {
      week: 'Неделя',
      decade: 'Декада',
      month: 'Месяц',
      last30: 'Последние 30 дней',
    }[orderListPeriod.value]
  }

  const { from, to } = orderListRange.value
  const formatter = new Intl.DateTimeFormat('ru-RU')
  if (from.getTime() === to.getTime()) return formatter.format(from)
  return `${formatter.format(from)}–${formatter.format(to)}`
})
const promRegistryEntriesByOrder = computed(
  () => new Map(promRegistryEntries.value.map((entry) => [entry.orderNumber, entry])),
)
const promRegistryMismatchCount = computed(() =>
  orders.value.reduce(
    (count, order) =>
      count +
      Number(isPromRegistryFieldMismatch(order, 'paymentAmount')) +
      Number(isPromRegistryFieldMismatch(order, 'acquiring')),
    0,
  ),
)
const isPromRegistryView = computed(() => promRegistryEntries.value.length > 0)
const promRegistryOrders = computed(() =>
  orders.value.filter((order) => promRegistryEntriesByOrder.value.has(registryKeyForOrder(order))),
)
const unmatchedPromRegistryEntries = computed(() =>
  promRegistryEntries.value.filter(
    (entry) => !orders.value.some((order) => registryKeyForOrder(order) === entry.orderNumber),
  ),
)
const unmatchedPromRegistryOrderNumbers = computed(() =>
  unmatchedPromRegistryEntries.value.map((entry) => entry.orderNumber).join(', '),
)
const promRegistryTotals = computed(() => ({
  paymentAmount:
    registrySource.value === 'Kasta'
      ? promRegistryOrders.value.reduce((total, order) => total + getOrderAmount(order), 0)
      : promRegistryEntries.value.reduce((total, entry) => total + entry.paymentAmount, 0),
  acquiring: promRegistryEntries.value.reduce((total, entry) => total + entry.acquiring, 0),
}))
const promRegistryNetTotal = computed(
  () => promRegistryTotals.value.paymentAmount - promRegistryTotals.value.acquiring,
)
const matchingOrders = computed(() => {
  const search = searchQuery.value.trim().toLowerCase()
  const ttnSearch = search.replace(/\D/g, '')
  const isTtnSearch = /^[\d\s-]+$/.test(search)
  const { from, to } = orderListRange.value
  return orders.value.filter((order) => {
    const haystack = [
      JSON.stringify(order),
      displayPaymentMethod(order.delivery.paymentMethod),
      orderHeaderPaymentLabel(order),
      promPaymentState(order) === 'paid' ? 'Оплачено' : '',
      promPaymentState(order) === 'error' ? 'Ошибка оплаты' : '',
    ]
      .join(' ')
      .toLowerCase()
    const matchesTtn =
      isTtnSearch &&
      ttnSearch.length >= 4 &&
      deliveryTtns(order.delivery).some((ttn) => ttn.replace(/\D/g, '').includes(ttnSearch))

    if (search) return haystack.includes(search) || matchesTtn

    const matchesPlatform =
      isShowingCancelledAndReturned.value ||
      platformFilter.value === 'all' ||
      orderBusinessPlatform(order) === platformFilter.value
    const matchesOrderState = isPromRegistryView.value
      ? true
      : isShowingCancelledAndReturned.value
        ? isCancelledOrReturned(order)
        : !isCancelledOrReturned(order)
    const orderDate = parseOrderDate(order.date)
    const matchesPeriod =
      isPromRegistryView.value || (orderDate !== null && orderDate >= from && orderDate <= to)
    return (
      matchesPlatform &&
      matchesOrderState &&
      matchesPeriod &&
      (!isPromRegistryView.value || promRegistryOrders.value.includes(order))
    )
  })
})
const unpaidOrdersCount = computed(
  () => matchingOrders.value.filter((order) => !isPaid(order)).length,
)
const visibleOrders = computed(() =>
  isShowingUnpaidOnly.value && !searchQuery.value.trim()
    ? matchingOrders.value.filter((order) => !isPaid(order))
    : matchingOrders.value,
)

function isOpenForPrintRegistry(order: Order) {
  const status = displayOrderStatus(order.status).toLowerCase()
  return (
    !isCancelledOrReturned(order) &&
    !/заверш|закрит|закрыт|виконан|выполнен|completed|finished|closed|delivered/.test(status)
  )
}

function isOrderUnprinted(order: Order) {
  return (
    Boolean(order.delivery.ttn.trim()) && !order.delivery.printedAt && isOpenForPrintRegistry(order)
  )
}

async function openPrintRegistry() {
  if (!supabase || isGuest.value || isPreparingPrintRegistry.value) return
  isPreparingPrintRegistry.value = true
  if (!(await waitForPendingSaves())) {
    isPreparingPrintRegistry.value = false
    return
  }

  const ordersWithoutTtn = orders.value.filter(
    (order) =>
      !order.delivery.printedAt &&
      isOpenForPrintRegistry(order) &&
      !order.delivery.ttn.trim() &&
      Boolean(order.externalId) &&
      ['Пром', 'Эпицентр', 'Каста'].includes(order.platform),
  )
  let syncErrors = 0
  const changedOrderIds = new Set<string>()
  const functions = supabase.functions
  const syncConcurrency = 4
  for (let index = 0; index < ordersWithoutTtn.length; index += syncConcurrency) {
    const batch = ordersWithoutTtn.slice(index, index + syncConcurrency)
    const results = await Promise.all(
      batch.map(async (order) => {
        const functionName =
          order.platform === 'Пром'
            ? 'sync-prom-orders'
            : order.platform === 'Эпицентр'
              ? 'sync-epicentr-orders'
              : 'sync-kasta-orders'
        const body =
          order.platform === 'Каста'
            ? { externalId: order.externalId }
            : {
                externalId: order.externalId,
                manual: orderSyncSnapshot(orderWithRegistryFinancialsRestored(order)),
              }
        return functions.invoke(functionName, {
          method: 'POST',
          body,
        })
      }),
    )
    for (const { data, error } of results) {
      if (error || !data?.ok) {
        syncErrors += 1
        continue
      }
      for (const id of Array.isArray(data.changedOrderIds) ? data.changedOrderIds : [])
        if (typeof id === 'string') changedOrderIds.add(id)
    }
  }
  const registryRefreshIds = new Set(changedOrderIds)
  for (const order of ordersWithoutTtn) {
    if (order.remoteId) registryRefreshIds.add(order.remoteId)
  }
  if (registryRefreshIds.size) {
    const registryRefreshSucceeded = await refreshRemoteOrders([...registryRefreshIds])
    if (!registryRefreshSucceeded) {
      isPreparingPrintRegistry.value = false
      showSyncError(
        'Не удалось получить актуальные данные заказов перед формированием реестра. Реестр не сформирован.',
      )
      return
    }
  }

  const registryOrders = orders.value.filter(
    (order) =>
      !order.delivery.printedAt &&
      isOpenForPrintRegistry(order) &&
      order.delivery.ttn.trim().length > 0,
  )
  printRegistryOrderIds.value = registryOrders.map((order) => order.id)
  const uncheckedOrders = registryOrders.filter((order) => !order.delivery.printCheckedAt)
  if (uncheckedOrders.length) {
    const printCheckedAt = new Date().toISOString()
    if (await savePrintState(uncheckedOrders.map((order) => ({ order, printCheckedAt })))) {
      for (const order of uncheckedOrders) order.delivery.printCheckedAt = printCheckedAt
      window.localStorage.setItem(storageKey, JSON.stringify(orders.value))
    }
  }
  isPreparingPrintRegistry.value = false
  printRegistryMode.value = 'draft'
  if (syncErrors)
    showSyncError(`Не удалось проверить заказов без ТТН: ${syncErrors}. Они не добавлены в реестр.`)
}

function closePrintRegistry() {
  printRegistryMode.value = null
  printRegistryOrderIds.value = []
}

function showPrintRegistryHistory() {
  printRegistryMode.value = 'history'
}

function showCurrentPrintRegistry() {
  printRegistryMode.value = 'draft'
}

async function savePrintState(
  updates: Array<{
    order: Order
    printCheckedAt?: string | null
    printedAt?: string | null
  }>,
) {
  if (!supabase || isGuest.value || isUpdatingPrintRegistry.value) return false
  const missingRemoteOrder = updates.find((update) => !update.order.remoteId)
  if (missingRemoteOrder) {
    await persistOrders(missingRemoteOrder.order)
    await waitForPendingSaves()
  }
  if (updates.some((update) => !update.order.remoteId)) {
    showSyncError('Не удалось сохранить отметку: один из заказов ещё не записан в базе.')
    return false
  }

  isUpdatingPrintRegistry.value = true
  const { data, error } = await supabase.functions.invoke('update-order-print-state', {
    method: 'POST',
    body: {
      updates: updates.map((update) => ({
        orderId: update.order.remoteId,
        ...('printCheckedAt' in update ? { printCheckedAt: update.printCheckedAt } : {}),
        ...('printedAt' in update ? { printedAt: update.printedAt } : {}),
      })),
    },
  })
  isUpdatingPrintRegistry.value = false
  if (error || !data?.ok) {
    showSyncError(data?.message ?? error?.message ?? 'Не удалось сохранить отметки печати.')
    return false
  }
  return true
}

async function handlePrintCheckedChange(order: Order, checked: boolean) {
  const printCheckedAt = checked ? new Date().toISOString() : null
  if (!(await savePrintState([{ order, printCheckedAt }]))) return
  order.delivery.printCheckedAt = printCheckedAt ?? undefined
  window.localStorage.setItem(storageKey, JSON.stringify(orders.value))
}

async function handlePrintCheckAll(checked: boolean) {
  const registryOrders = printRegistryOrders.value
  if (!registryOrders.length) return
  const printCheckedAt = checked ? new Date().toISOString() : null
  if (!(await savePrintState(registryOrders.map((order) => ({ order, printCheckedAt }))))) return
  for (const order of registryOrders) order.delivery.printCheckedAt = printCheckedAt ?? undefined
  window.localStorage.setItem(storageKey, JSON.stringify(orders.value))
}

async function markPrintRegistryPrinted() {
  const registryOrders = printRegistryOrders.value.filter((order) => order.delivery.printCheckedAt)
  if (!registryOrders.length) return
  if (!window.confirm(`Отметить распечатанными ${registryOrders.length} заказов?`)) return
  const printedAt = new Date().toISOString()
  if (!(await savePrintState(registryOrders.map((order) => ({ order, printedAt }))))) return
  for (const order of registryOrders) order.delivery.printedAt = printedAt
  window.localStorage.setItem(storageKey, JSON.stringify(orders.value))
  closePrintRegistry()
  showSyncMessage(`Распечатанными отмечено заказов: ${registryOrders.length}.`)
}

async function restoreUncheckedPrintedOrders() {
  const uncheckedOrders = printRegistryOrders.value.filter(
    (order) => order.delivery.printedAt && !order.delivery.printCheckedAt,
  )
  if (!uncheckedOrders.length) return
  if (!window.confirm(`Вернуть ${uncheckedOrders.length} заказов в нераспечатанные?`)) return
  if (
    !(await savePrintState(
      uncheckedOrders.map((order) => ({ order, printCheckedAt: null, printedAt: null })),
    ))
  )
    return
  for (const order of uncheckedOrders) {
    order.delivery.printCheckedAt = undefined
    order.delivery.printedAt = undefined
  }
  window.localStorage.setItem(storageKey, JSON.stringify(orders.value))
  showSyncMessage(`Возвращено в нераспечатанные: ${uncheckedOrders.length}.`)
}

async function restorePrintedOrder(order: Order) {
  if (!window.confirm(`Вернуть заказ ${order.displayNumber ?? order.id} в нераспечатанные?`)) return
  if (!(await savePrintState([{ order, printCheckedAt: null, printedAt: null }]))) return
  order.delivery.printCheckedAt = undefined
  order.delivery.printedAt = undefined
  window.localStorage.setItem(storageKey, JSON.stringify(orders.value))
}

function toggleCancelledAndReturned() {
  isShowingCancelledAndReturned.value = !isShowingCancelledAndReturned.value
  if (isShowingCancelledAndReturned.value) {
    platformFilter.value = 'all'
    isShowingUnpaidOnly.value = false
  }
}

function toggleUnpaidOrders() {
  isShowingUnpaidOnly.value = !isShowingUnpaidOnly.value
  if (isShowingUnpaidOnly.value) isShowingCancelledAndReturned.value = false
}

function scrollOrdersToTop() {
  window.scrollTo({ top: 0, left: 0, behavior: 'smooth' })
}

const summary = computed(() => {
  const sum = (items: Order[], getter: (order: Order) => number) =>
    items.reduce((total, order) => total + getter(order), 0)
  return {
    today: {
      orders: ordersForToday.value.length,
      turnover: sum(ordersForToday.value, getNetOrderAmount),
      planned: sum(ordersForToday.value, getPlannedProfit),
    },
    period: {
      orders: ordersForSelectedPeriod.value.length,
      turnover: sum(ordersForSelectedPeriod.value, getNetOrderAmount),
      planned: sum(ordersForSelectedPeriod.value, getPlannedProfit),
      actual: sum(ordersForSelectedPeriod.value.filter(hasActualFinancialResult), getActualProfit),
    },
    previous: {
      orders: ordersForPreviousPeriod.value.length,
      turnover: sum(ordersForPreviousPeriod.value, getNetOrderAmount),
      planned: sum(ordersForPreviousPeriod.value, getPlannedProfit),
      actual: sum(ordersForPreviousPeriod.value.filter(hasActualFinancialResult), getActualProfit),
    },
  }
})

const platformSummary = computed(() =>
  platformOptions.map((platform) => {
    const platformOrders = ordersForPlatformSummary.value.filter(
      (order) => orderBusinessPlatform(order) === platform,
    )
    return {
      platform,
      count: platformOrders.length,
      turnover: platformOrders.reduce((sum, order) => sum + getNetOrderAmount(order), 0),
      planned: platformOrders.reduce((sum, order) => sum + getPlannedProfit(order), 0),
      actual: platformOrders
        .filter(hasActualFinancialResult)
        .reduce((sum, order) => sum + getActualProfit(order), 0),
    }
  }),
)

function createProduct(): OrderProduct {
  return { id: crypto.randomUUID(), name: '', size: '', quantity: 1, price: 0, cost: 0 }
}

function marketplacePriceLinkKey(platform: Platform, marketplaceProductKey: string) {
  return `${platform}:${marketplaceProductKey}`
}

async function refreshLinkedPriceProductKeys() {
  if (!supabase) return
  const { data: priceLinks, error } = await supabase
    .from('crm_product_price_links')
    .select('platform, marketplace_product_key')
  if (error) {
    console.error('Не удалось загрузить привязки себестоимости:', error)
    return
  }
  linkedPriceProductKeys.value = new Set(
    (priceLinks ?? []).map((link) =>
      marketplacePriceLinkKey(link.platform as Platform, String(link.marketplace_product_key)),
    ),
  )
}

function canLinkProductPrice(order: Order, product: OrderProduct) {
  return (
    ['Пром', 'Эпицентр', 'Каста'].includes(order.platform) &&
    Boolean(order.remoteId) &&
    Boolean(order.externalId) &&
    product.position !== undefined
  )
}

function isProductPriceLinked(order: Order, product: OrderProduct) {
  return Boolean(
    product.marketplaceProductKey &&
    linkedPriceProductKeys.value.has(
      marketplacePriceLinkKey(order.platform, product.marketplaceProductKey),
    ),
  )
}

function isFamilyPriceLinkKey(platform: Platform, key: string) {
  if (platform === 'Пром') return /^(?:sku|external|product):/.test(key)
  if (platform === 'Эпицентр') return /^(?:product|offer):/.test(key)
  if (platform === 'Каста') return /^(?:supplier|product):/.test(key) && !key.includes('|size:')
  return false
}

async function refreshPriceLinkProductKey(order: Order, product: OrderProduct) {
  if (
    !supabase ||
    !order.externalId ||
    !order.remoteId ||
    product.position === undefined ||
    isMarketplaceSyncBusy.value
  )
    return product.marketplaceProductKey ?? ''

  const functionName =
    order.platform === 'Пром'
      ? 'sync-prom-orders'
      : order.platform === 'Эпицентр'
        ? 'sync-epicentr-orders'
        : 'sync-kasta-orders'
  const body =
    order.platform === 'Каста'
      ? { externalId: order.externalId }
      : {
          externalId: order.externalId,
          manual: orderSyncSnapshot(orderWithRegistryFinancialsRestored(order)),
        }
  const { data, error } = await supabase.functions.invoke(functionName, { method: 'POST', body })
  if (error || !data?.ok) {
    showSyncError(
      data?.message ??
        error?.message ??
        'Не удалось обновить идентификатор товара перед привязкой.',
    )
    return ''
  }

  const { data: rows, error: itemError } = await supabase
    .from('crm_order_items')
    .select('position, product_name, marketplace_product_key')
    .eq('order_id', order.remoteId)
    .order('position')
  if (itemError) {
    showSyncError(`Не удалось проверить товар перед привязкой: ${itemError.message}`)
    return ''
  }
  const refreshedItem =
    (rows ?? []).find(
      (row) => Number(row.position) === product.position && row.product_name === product.name,
    ) ?? (rows ?? []).find((row) => row.product_name === product.name)
  const refreshedKey = String(refreshedItem?.marketplace_product_key ?? '').trim()
  if (!refreshedKey) {
    showSyncError('Площадка не вернула стабильный идентификатор товара без привязки к размеру.')
    return ''
  }
  void refreshOrdersAfterMarketplaceSync(data)
  return refreshedKey
}

async function openProductPriceLink(order: Order, product: OrderProduct) {
  if (isGuest.value || !canLinkProductPrice(order, product)) return
  let linkProductKey = product.marketplaceProductKey ?? ''
  if (!linkProductKey || !isFamilyPriceLinkKey(order.platform, linkProductKey)) {
    linkProductKey = await refreshPriceLinkProductKey(order, product)
    if (!linkProductKey || !isFamilyPriceLinkKey(order.platform, linkProductKey)) return
  }
  await router.push({
    path: '/prices',
    query: {
      linkMode: '1',
      linkPlatform: order.platform,
      linkProductKey,
      linkOrderRemoteId: order.remoteId,
      linkPosition: String(product.position),
      linkTitle: product.name,
      ...(product.size ? { linkSize: product.size } : {}),
      returnOrder: String(order.id),
      ...(searchQuery.value ? { returnSearch: searchQuery.value } : {}),
      ...(isPromRegistryDraft.value ? { returnRegistry: '1' } : {}),
    },
  })
}

function updateDraftUsdCost(product: OrderProduct, event: Event) {
  product.costManual = true
  const value = Number((event.target as HTMLInputElement).value.replace(',', '.'))
  if (!Number.isFinite(value)) return
  product.costUsd = value
  if (value !== 0) product.cost = value * usdRate.value
}

function createOrderDraft(): Order {
  return {
    id:
      Math.max(
        0,
        ...orders.value
          .map((order) => order.orderNumber ?? Number(order.id))
          .filter(Number.isFinite),
      ) + 1,
    date: todayKey(),
    time: currentTime(),
    customer: '',
    phone: '',
    platform: 'Р/С',
    status: 'В дороге',
    products: [createProduct()],
    shipping: 0,
    paymentAmount: 0,
    acquiring: 0,
    extraExpenses: 0,
    delivery: {
      carrier: 'Новая почта',
      ttn: '',
      recipient: '',
      recipientPhone: '',
      city: '',
      address: '',
      status: 'Запланировано',
      payer: 'Получатель',
    },
  }
}

function orderWithRegistryFinancialsRestored(order: Order): Order {
  if (!isPromRegistryDraft.value) return order
  const original = promRegistryOriginalFinancials.get(order.id)
  if (!original) return order
  return {
    ...order,
    paymentAmount: original.paymentAmount,
    acquiring: original.acquiring,
    acquiringPercent: original.acquiringPercent,
    delivery: { ...order.delivery, paymentAmount: original.paymentAmount },
  }
}

function incrementPendingLocalSaves(savedOrders: Order[]) {
  const remoteIds = new Set(
    savedOrders
      .map((savedOrder) => savedOrder.remoteId)
      .filter((remoteId): remoteId is string => typeof remoteId === 'string'),
  )
  for (const remoteId of remoteIds)
    pendingLocalOrderSaves.set(remoteId, (pendingLocalOrderSaves.get(remoteId) ?? 0) + 1)
  return remoteIds
}

function decrementPendingLocalSaves(remoteIds: Set<string>) {
  for (const remoteId of remoteIds) {
    const remaining = (pendingLocalOrderSaves.get(remoteId) ?? 1) - 1
    if (remaining > 0) {
      pendingLocalOrderSaves.set(remoteId, remaining)
      continue
    }
    pendingLocalOrderSaves.delete(remoteId)
    if (deferredRemoteOrderIds.delete(remoteId)) queueRemoteOrderRefresh(remoteId)
  }
}

function persistOrders(order?: Order) {
  if (isGuest.value) return Promise.resolve()
  const savedOrders = order
    ? [orderWithRegistryFinancialsRestored(order)]
    : orders.value.map(orderWithRegistryFinancialsRestored)
  const localOrders = orders.value.map(orderWithRegistryFinancialsRestored)
  const pendingRemoteIds = incrementPendingLocalSaves(savedOrders)
  persistenceQueue = persistenceQueue
    .catch((error: unknown) => console.error('Не удалось сохранить заказ:', error))
    .then(() => persistOrdersNow(savedOrders, localOrders))
    .finally(() => decrementPendingLocalSaves(pendingRemoteIds))
  return persistenceQueue
}

function serializeOrder(order: Order) {
  return {
    remoteId: order.remoteId,
    order_label: order.displayNumber ?? null,
    order_number: order.orderNumber ?? Number(order.id),
    order_date: order.date,
    order_time: order.time ?? null,
    customer: order.customer,
    phone: order.phone,
    customer_email: order.customerEmail ?? null,
    customer_comment: order.customerComment ?? null,
    internal_comment: order.internalComment ?? null,
    platform: order.platform,
    status: order.status,
    shipping: order.shipping,
    acquiring: order.acquiring,
    acquiring_percent: order.acquiringPercent ?? null,
    extra_expenses: order.extraExpenses ?? 0,
    delivery: { ...order.delivery, paymentAmount: order.paymentAmount },
    items: order.products.map((product) => ({
      product_name: product.name,
      size: product.size,
      quantity: product.quantity,
      price: product.price,
      image_url: product.imageUrl ?? null,
      cost: product.cost,
      cost_usd: product.costUsd ?? 0,
      marketplace_product_key: product.marketplaceProductKey ?? null,
      cost_manual: product.costManual ?? false,
      price_item_id: product.priceItemId ?? null,
      royalty_percent: product.royaltyPercent ?? null,
      royalty_amount: product.royaltyAmount ?? null,
      royalty_manual: product.royaltyManual ?? false,
    })),
  }
}

function productReturnKey(order: Order, product: OrderProduct) {
  return `${order.remoteId ?? ''}:${product.position ?? -1}`
}

function returnSignalLabel(order: Order) {
  if (order.delivery.trackingNormalizedStatus === 'returning') return 'Возвращается'
  if (order.delivery.trackingNormalizedStatus === 'returned') return 'Возврат прибыл'
  if (/повер|возврат|return|refund/i.test(order.status)) return 'Возврат заявлен'
  if (order.delivery.printedAt && /скас|отмен|cancel/i.test(order.status))
    return 'Отменён после сборки — возможен возврат'
  return null
}

function isReturnEditorOpen(order: Order) {
  return returnEditorOrderId.value === order.id
}

function returnDraftQuantity(order: Order, product: OrderProduct) {
  return returnDraftQuantities.value[productReturnKey(order, product)] ?? '0'
}

function openReturnEditor(order: Order) {
  if (isGuest.value || !order.remoteId || !order.delivery.printedAt) return
  if (isReturnEditorOpen(order)) {
    returnEditorOrderId.value = null
    return
  }
  returnEditorOrderId.value = order.id
  returnDraftQuantities.value = Object.fromEntries(
    order.products.map((product) => [
      productReturnKey(order, product),
      String(product.returnedQuantity ?? 0),
    ]),
  )
  returnDraftDate.value = new Date().toISOString().slice(0, 10)
}

function acceptWholeReturnDraft(order: Order) {
  for (const product of order.products) {
    returnDraftQuantities.value[productReturnKey(order, product)] = String(product.quantity)
  }
}

function isOrderFullyReturned(order: Order) {
  return (
    order.products.length > 0 &&
    order.products.every((product) => (product.returnedQuantity ?? 0) >= product.quantity)
  )
}

async function saveAcceptedReturns(order: Order) {
  if (
    !supabase ||
    isGuest.value ||
    isSavingReturn.value ||
    !order.remoteId ||
    !order.delivery.printedAt ||
    !order.products.length ||
    !returnDraftDate.value
  )
    return
  const products = order.products.filter(
    (product): product is OrderProduct & { position: number } => product.position !== undefined,
  )
  if (products.length !== order.products.length) {
    showSyncError('Не удалось определить позиции заказа для возврата.')
    return
  }
  const returnedProducts = products.map((product) => ({
    product,
    returnedQuantity: Number(returnDraftQuantity(order, product)),
  }))
  if (
    returnedProducts.some(
      ({ product, returnedQuantity }) =>
        !Number.isInteger(returnedQuantity) ||
        returnedQuantity < 0 ||
        returnedQuantity > product.quantity,
    )
  ) {
    showSyncError('Укажите целое количество возврата в пределах количества позиции.')
    return
  }
  if (
    returnedProducts.every(({ returnedQuantity }) => returnedQuantity === 0) &&
    products.every((product) => (product.returnedQuantity ?? 0) === 0)
  ) {
    showSyncError('Укажите хотя бы одну принятую к возврату позицию.')
    return
  }
  const reductions = returnedProducts.filter(
    ({ product, returnedQuantity }) => returnedQuantity < (product.returnedQuantity ?? 0),
  )
  if (
    reductions.length &&
    !window.confirm('Уменьшение принятого возврата вернёт себестоимость в долг. Продолжить?')
  )
    return
  isSavingReturn.value = true
  const { error } = await supabase.from('crm_order_item_returns').upsert(
    returnedProducts.map(({ product, returnedQuantity }) => ({
      order_id: order.remoteId,
      item_position: product.position,
      product_name: product.name,
      returned_quantity: returnedQuantity,
      returned_at: returnDraftDate.value,
    })),
    { onConflict: 'order_id,item_position' },
  )
  isSavingReturn.value = false
  if (error) {
    showSyncError(`Не удалось сохранить возврат: ${error.message}`)
    return
  }
  for (const { product, returnedQuantity } of returnedProducts) {
    product.returnedQuantity = returnedQuantity
    product.returnedAt = returnDraftDate.value
  }
  returnEditorOrderId.value = null
  showSyncMessage(`Принятый возврат по заказу № ${order.id} сохранён.`)
}

async function persistOrdersNow(savedOrders: Order[], localOrders = orders.value) {
  if (isGuest.value) return
  window.localStorage.setItem(storageKey, JSON.stringify(localOrders))
  if (!supabase) return
  const { data, error } = await supabase.functions.invoke('save-crm-orders', {
    method: 'POST',
    body: {
      orders: savedOrders.map(serializeOrder),
    },
  })
  if (error || !data?.ok)
    throw new Error(data?.message ?? error?.message ?? 'Не удалось сохранить заказы.')
  for (const saved of data.saved as Array<{ orderNumber: number; remoteId: string }>) {
    const order = orders.value.find(
      (item) =>
        item.remoteId === saved.remoteId || (item.orderNumber ?? item.id) === saved.orderNumber,
    )
    if (order) order.remoteId = saved.remoteId
  }
}

async function signIn() {
  if (!supabase) {
    authError.value = 'Supabase не настроен.'
    return
  }
  isSigningIn.value = true
  authError.value = ''
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.value,
    password: password.value,
  })
  isSigningIn.value = false
  if (error) {
    authError.value = error.message
    return
  }
  user.value = data.user
  window.location.reload()
}

async function signOut() {
  await supabase?.auth.signOut()
  user.value = null
  window.location.reload()
}

async function syncEpicentrOrders(full = false, fullSyncResults?: string[]) {
  if (!supabase || isGuest.value || isSyncingEpicentr.value) return
  isSyncingEpicentr.value = true
  if (!(await waitForPendingSaves())) {
    isSyncingEpicentr.value = false
    return
  }
  syncEpicentrMessage.value = ''
  const { data, error } = await supabase.functions.invoke('sync-epicentr-orders', {
    method: 'POST',
    body: full ? { full: true } : undefined,
  })
  isSyncingEpicentr.value = false
  if (error || !data?.ok) {
    const errorMessage = data?.message ?? error?.message ?? 'Не удалось обновить заказы Эпицентра.'
    if (fullSyncResults) fullSyncResults.push(`Эпицентр: ошибка — ${errorMessage}`)
    else showSyncError(errorMessage)
    return
  }
  const message = full
    ? `Эпицентр: полная синхронизация — найдено ${data.received}, обновлено ${data.updated}, добавлено ${data.created}.`
    : `Эпицентр: найдено ${data.received}, добавлено новых ${data.created}, уже есть ${data.skipped ?? 0} — не изменены.`
  if (fullSyncResults) fullSyncResults.push(message)
  else showSyncMessage(message)
  await refreshOrdersAfterMarketplaceSync(data)
}

async function syncPromOrders(full = false, fullSyncResults?: string[]) {
  if (!supabase || isGuest.value || isSyncingProm.value) return
  isSyncingProm.value = true
  if (!(await waitForPendingSaves())) {
    isSyncingProm.value = false
    return
  }
  syncEpicentrMessage.value = ''
  const { data, error } = await supabase.functions.invoke('sync-prom-orders', {
    method: 'POST',
    body: full ? { full: true } : undefined,
  })
  isSyncingProm.value = false
  if (error || !data?.ok) {
    const errorMessage = data?.message ?? error?.message ?? 'Не удалось обновить заказы Prom.'
    if (fullSyncResults) fullSyncResults.push(`Prom: ошибка — ${errorMessage}`)
    else showSyncError(errorMessage)
    return
  }
  const message = full
    ? `Prom: полная синхронизация — найдено ${data.received}, обновлено ${data.updated}, добавлено ${data.created}.`
    : `Prom: найдено ${data.received}, добавлено новых ${data.created}, уже есть ${data.skipped ?? 0} — не изменены.`
  if (fullSyncResults) fullSyncResults.push(message)
  else showSyncMessage(message)
  await refreshOrdersAfterMarketplaceSync(data)
}

async function syncKastaOrders(full = false, fullSyncResults?: string[]) {
  if (!supabase || isGuest.value || isSyncingKasta.value) return
  isSyncingKasta.value = true
  if (!(await waitForPendingSaves())) {
    isSyncingKasta.value = false
    return
  }
  syncEpicentrMessage.value = ''
  const { data, error } = await supabase.functions.invoke('sync-kasta-orders', {
    method: 'POST',
    body: full ? { full: true } : undefined,
  })
  isSyncingKasta.value = false
  if (error || !data?.ok) {
    const errorMessage = data?.message ?? error?.message ?? 'Не удалось обновить заказы Касты.'
    if (fullSyncResults) fullSyncResults.push(`Каста: ошибка — ${errorMessage}`)
    else showSyncError(errorMessage)
    return
  }
  const message = full
    ? `Каста: полная синхронизация — найдено ${data.received}, обновлено ${data.updated}, добавлено ${data.created}.`
    : `Каста: найдено ${data.received}, добавлено ${data.created}, обновлено ${data.updated}, без изменений ${data.skippedUnchanged ?? data.skipped ?? 0}.`
  if (fullSyncResults) fullSyncResults.push(message)
  else showSyncMessage(message)
  await refreshOrdersAfterMarketplaceSync(data)
}

async function syncNewAllPlatforms() {
  if (isMarketplaceSyncBusy.value) return
  isSyncingAllPlatforms.value = true
  try {
    await syncEpicentrOrders()
    await syncPromOrders()
    await syncKastaOrders()
  } finally {
    isSyncingAllPlatforms.value = false
  }
}

async function syncFullAllPlatforms() {
  if (isMarketplaceSyncBusy.value) return
  if (
    !window.confirm(
      'Полная синхронизация обновит доступные заказы Prom и Эпицентра, а также заказы Kasta за последние 7 дней. Продолжить?',
    )
  )
    return
  isSyncingAllPlatforms.value = true
  const fullSyncResults: string[] = []
  try {
    await syncEpicentrOrders(true, fullSyncResults)
    await syncPromOrders(true, fullSyncResults)
    await syncKastaOrders(true, fullSyncResults)
    showSyncMessage(fullSyncResults.join('\n'))
  } finally {
    isSyncingAllPlatforms.value = false
  }
}

async function syncDeliveryTracking() {
  if (!supabase || isGuest.value || isSyncingDelivery.value) return
  isSyncingDelivery.value = true
  const { data, error } = await supabase.functions.invoke<{
    ok?: boolean
    message?: string
    checked?: number
    updated?: number
    failed?: number
  }>('sync-delivery-tracking', {
    method: 'POST',
    body: { force: true },
  })
  isSyncingDelivery.value = false
  if (error || !data?.ok) {
    showSyncError(data?.message ?? error?.message ?? 'Не удалось обновить статусы доставок.')
    return
  }
  showSyncMessage(
    `Доставки: проверено ${data.checked ?? 0}, обновлено ${data.updated ?? 0}, ошибок ${data.failed ?? 0}.`,
  )
}

async function syncKastaOrder(order: Order) {
  if (
    !supabase ||
    isGuest.value ||
    isSyncingAllPlatforms.value ||
    isSyncingKasta.value ||
    order.platform !== 'Каста' ||
    !order.externalId
  )
    return
  isSyncingKasta.value = true
  if (!(await waitForPendingSaves())) {
    isSyncingKasta.value = false
    return
  }
  syncEpicentrMessage.value = ''
  const { data, error } = await supabase.functions.invoke('sync-kasta-orders', {
    method: 'POST',
    body: { externalId: order.externalId },
  })
  isSyncingKasta.value = false
  if (error || !data?.ok) {
    showSyncError(data?.message ?? error?.message ?? 'Не удалось обновить заказ Каста.')
    return
  }
  showSyncMessage(`Заказ № ${order.displayNumber ?? order.id} обновлён из Каста.`)
  await refreshOrdersAfterMarketplaceSync(data)
  showInlineActionNotice(`sync:${order.id}`, 'Синхронизировано')
}

async function syncPromOrder(order: Order) {
  if (
    !supabase ||
    isGuest.value ||
    isSyncingAllPlatforms.value ||
    isSyncingProm.value ||
    order.platform !== 'Пром' ||
    !order.externalId
  )
    return
  isSyncingProm.value = true
  if (!(await waitForPendingSaves())) {
    isSyncingProm.value = false
    return
  }
  syncEpicentrMessage.value = ''
  const { data, error } = await supabase.functions.invoke('sync-prom-orders', {
    method: 'POST',
    body: {
      externalId: order.externalId,
      manual: orderSyncSnapshot(orderWithRegistryFinancialsRestored(order)),
    },
  })
  isSyncingProm.value = false
  if (error || !data?.ok) {
    showSyncError(data?.message ?? error?.message ?? 'Не удалось обновить заказ Prom.')
    return
  }
  showSyncMessage(`Заказ № ${order.id} обновлён из Prom.`)
  await refreshOrdersAfterMarketplaceSync(data)
  showInlineActionNotice(`sync:${order.id}`, 'Синхронизировано')
}

async function syncEpicentrOrder(order: Order) {
  if (
    !supabase ||
    isGuest.value ||
    isSyncingAllPlatforms.value ||
    isSyncingEpicentr.value ||
    order.platform !== 'Эпицентр' ||
    !order.externalId
  )
    return
  isSyncingEpicentr.value = true
  if (!(await waitForPendingSaves())) {
    isSyncingEpicentr.value = false
    return
  }
  syncEpicentrMessage.value = ''
  const { data, error } = await supabase.functions.invoke('sync-epicentr-orders', {
    method: 'POST',
    body: {
      externalId: order.externalId,
      manual: orderSyncSnapshot(orderWithRegistryFinancialsRestored(order)),
    },
  })
  isSyncingEpicentr.value = false
  if (error || !data?.ok) {
    showSyncError(data?.message ?? error?.message ?? 'Не удалось обновить заказ Эпицентра.')
    return
  }
  showSyncMessage(`Заказ № ${order.id} обновлён из Эпицентра.`)
  await refreshOrdersAfterMarketplaceSync(data)
  showInlineActionNotice(`sync:${order.id}`, 'Синхронизировано')
}

function orderSyncSnapshot(order: Order) {
  return {
    acquiring: order.acquiring,
    acquiringPercent: order.acquiringPercent ?? null,
    items: order.products.map((product) => ({
      name: product.name,
      size: product.size,
      cost: product.cost,
      costUsd: product.costUsd ?? 0,
      marketplaceProductKey: product.marketplaceProductKey,
      costManual: product.costManual ?? false,
      priceItemId: product.priceItemId,
      royaltyPercent: product.royaltyPercent ?? null,
      royaltyAmount: product.royaltyAmount ?? null,
      royaltyManual: product.royaltyManual ?? false,
    })),
  }
}

async function refreshOrdersAfterMarketplaceSync(data: { changedOrderIds?: unknown }) {
  const ids = Array.isArray(data.changedOrderIds)
    ? data.changedOrderIds.filter((id): id is string => typeof id === 'string')
    : null
  if (ids === null) await reconcileRemoteOrders(true)
  else if (!ordersRealtimeSubscribed.value && ids.length) await refreshRemoteOrders(ids)
  await refreshLinkedPriceProductKeys()
  reapplyRegistryPreview(
    isPromRegistryDraft.value,
    promRegistryEntries.value,
    applyPromRegistryPreview,
  )
}

function scheduleTargetedOrdersRefresh(delay = 750) {
  if (realtimeRefreshTimer) window.clearTimeout(realtimeRefreshTimer)
  realtimeRefreshTimer = window.setTimeout(() => {
    realtimeRefreshTimer = undefined
    const ids = [...pendingRemoteOrderIds]
    pendingRemoteOrderIds.clear()
    void refreshRemoteOrders(ids)
  }, delay)
}

function queueRemoteOrderRefresh(remoteId: string | undefined) {
  if (!remoteId) return
  pendingRemoteOrderIds.add(remoteId)
  scheduleTargetedOrdersRefresh()
}

function removeRemoteOrder(remoteId: string | undefined) {
  if (!remoteId) return
  orders.value = orders.value.filter((order) => order.remoteId !== remoteId)
  unregisterRemoteOrder(remoteId)
}

function scheduleReconciliation(delay = 750, force = false) {
  if (!force && Date.now() - lastReconciliationAt < 60_000) return
  if (reconciliationTimer) window.clearTimeout(reconciliationTimer)
  reconciliationTimer = window.setTimeout(() => {
    reconciliationTimer = undefined
    void reconcileRemoteOrders(force)
  }, delay)
}

function scheduleRealtimeReconnect(delay = 2000) {
  if (
    !supabase ||
    !isAutomaticOrdersRefreshActive ||
    isRealtimeRestarting ||
    realtimeReconnectTimer
  )
    return
  realtimeReconnectTimer = window.setTimeout(() => {
    realtimeReconnectTimer = undefined
    void restartAutomaticOrdersRefresh()
  }, delay)
}

async function restartAutomaticOrdersRefresh() {
  if (!supabase || !isAutomaticOrdersRefreshActive || isRealtimeRestarting) return
  isRealtimeRestarting = true
  const channel = ordersRealtimeChannel
  ordersRealtimeChannel = undefined
  try {
    if (channel) await supabase.removeChannel(channel)
  } finally {
    isRealtimeRestarting = false
  }
  if (isAutomaticOrdersRefreshActive) startAutomaticOrdersRefresh()
}

function handleOrdersVisibilityChange() {
  if (documentVisibility.value !== 'visible') return
  void reconcileRemoteOrders(true)
  if (!ordersRealtimeSubscribed.value) scheduleRealtimeReconnect(0)
}

function handleBrowserOnline() {
  if (!isOnline.value) return
  void reconcileRemoteOrders(true)
  if (!ordersRealtimeSubscribed.value) scheduleRealtimeReconnect(0)
}

function startAutomaticOrdersRefresh() {
  if (!supabase || ordersRealtimeChannel) return
  isAutomaticOrdersRefreshActive = true
  ordersRealtimeSubscribed.value = false
  void supabase.realtime.setAuth()
  ordersRealtimeChannel = supabase
    .channel('crm:orders', { config: { private: true } })
    .on('broadcast', { event: 'order_changed' }, ({ payload }) => {
      const event = payload as { order_id?: string; operation?: string }
      if (!event.order_id) return
      if (event.operation === 'DELETE') removeRemoteOrder(event.order_id)
      else {
        if (event.operation === 'INSERT') pendingNewOrderIds.add(event.order_id)
        queueRemoteOrderRefresh(event.order_id)
      }
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        ordersRealtimeSubscribed.value = true
        if (realtimeReconnectTimer) {
          window.clearTimeout(realtimeReconnectTimer)
          realtimeReconnectTimer = undefined
        }
        scheduleReconciliation(0, true)
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        ordersRealtimeSubscribed.value = false
        scheduleRealtimeReconnect()
      }
    })
}

function sortOrders() {
  orders.value.sort(
    (left, right) =>
      orderDateTime(right) - orderDateTime(left) ||
      (right.orderNumber ?? 0) - (left.orderNumber ?? 0),
  )
}

function mapRemoteOrders(
  remoteOrders: Array<Record<string, unknown>>,
  orderItemReturns: OrderItemReturn[] | null,
) {
  if (remoteOrders) {
    const returnedItemsByKey = new Map(
      (orderItemReturns ?? []).map((item) => [`${item.order_id}:${item.item_position}`, item]),
    )
    return remoteOrders.map((row) => {
      const items = row.crm_order_items as Array<Record<string, unknown>>
      return {
        id: (row.order_label as string | null) ?? String(row.order_number),
        orderNumber: Number(row.order_number),
        displayNumber: (row.order_label as string | null) ?? undefined,
        remoteId: row.id as string,
        externalId: (row.external_id as string | null) ?? undefined,
        date: row.order_date as string,
        time: (row.order_time as string | null) ?? undefined,
        customer: row.customer as string,
        phone: row.phone as string,
        customerEmail: (row.customer_email as string | null) ?? undefined,
        customerComment: (row.customer_comment as string | null) ?? undefined,
        internalComment: (row.internal_comment as string | null) ?? undefined,
        platform: row.platform as Platform,
        status: row.status as string,
        shipping: Number(row.shipping),
        paymentAmount: Number((row.delivery as Delivery).paymentAmount ?? 0),
        acquiring: Number(row.acquiring),
        acquiringPercent:
          row.acquiring_percent === null ? undefined : Number(row.acquiring_percent),
        extraExpenses: Number(row.extra_expenses ?? 0),
        delivery: row.delivery as Delivery,
        products: items
          .sort((a, b) => Number(a.position) - Number(b.position))
          .map((item) => {
            const returnedItem = returnedItemsByKey.get(`${row.id}:${item.position}`)
            return {
              id: item.id as string,
              position: Number(item.position),
              name: item.product_name as string,
              size: (item.size as string | null) ?? '',
              imageUrl: (item.image_url as string | null) ?? undefined,
              quantity: Number(item.quantity),
              price: Number(item.price),
              cost: Number(item.cost),
              costUsd: Number(item.cost_usd ?? 0),
              marketplaceProductKey: (item.marketplace_product_key as string | null) ?? undefined,
              costManual: item.cost_manual === true,
              priceItemId: (item.price_item_id as string | null) ?? undefined,
              royaltyPercent:
                item.royalty_percent === null ? undefined : Number(item.royalty_percent),
              royaltyAmount: item.royalty_amount === null ? undefined : Number(item.royalty_amount),
              royaltyManual: item.royalty_manual === true,
              returnedQuantity: Number(returnedItem?.returned_quantity ?? 0),
              returnedAt: returnedItem?.returned_at ?? undefined,
            }
          }),
      } satisfies Order
    })
  }
  return []
}

function focusedOrderCellOrder() {
  const activeElement = document.activeElement
  if (
    !(activeElement instanceof HTMLInputElement) &&
    !(activeElement instanceof HTMLTextAreaElement)
  )
    return undefined
  if (!activeElement.classList.contains('order-cell-edit')) return undefined
  const orderCard = activeElement.closest<HTMLElement>('[data-order-id]')
  if (!orderCard) return undefined
  return orders.value.find((order) => String(order.id) === orderCard.dataset.orderId)
}

function isRemoteOrderLocallyBusy(remoteId: string) {
  if (pendingLocalOrderSaves.has(remoteId)) return true
  if (editingOrderCell.value && orderFromEditKey(editingOrderCell.value)?.remoteId === remoteId)
    return true
  return focusedOrderCellOrder()?.remoteId === remoteId
}

async function refreshRemoteOrders(remoteIds: string[]): Promise<boolean> {
  if (!supabase) return false
  if (!remoteIds.length) return true
  const uniqueRemoteIds = [...new Set(remoteIds)]
  const refreshableIds = uniqueRemoteIds.filter((remoteId) => {
    if (!isRemoteOrderLocallyBusy(remoteId)) return true
    deferredRemoteOrderIds.add(remoteId)
    return false
  })
  const refreshedAllRequestedOrders = refreshableIds.length === uniqueRemoteIds.length
  if (!refreshableIds.length) return false
  const { data: remoteOrders, error: ordersError } = await supabase
    .from('crm_orders')
    .select('*, crm_order_items(*)')
    .in('id', refreshableIds)
  if (ordersError || !remoteOrders) {
    console.error('Не удалось обновить изменённые заказы CRM:', ordersError)
    return false
  }
  const { data: orderItemReturns, error: returnsError } = await supabase
    .from('crm_order_item_returns')
    .select('order_id, item_position, product_name, returned_quantity, returned_at')
    .in('order_id', refreshableIds)
  if (returnsError) {
    console.error('Не удалось обновить возвраты изменённых заказов CRM:', returnsError)
    return false
  }
  const refreshedOrders = mapRemoteOrders(remoteOrders, orderItemReturns)
  const refreshedIds = new Set(refreshedOrders.map((order) => order.remoteId))
  for (const remoteId of refreshableIds) {
    if (!refreshedIds.has(remoteId)) removeRemoteOrder(remoteId)
  }
  for (const order of refreshedOrders) {
    const index = orders.value.findIndex((item) => item.remoteId === order.remoteId)
    if (index === -1) {
      orders.value.push(order)
      if (pendingNewOrderIds.delete(order.remoteId)) notifyNewOrder(order)
    } else orders.value[index] = order
  }
  registerRefreshedRemoteOrders(
    refreshedOrders.map((order) => ({
      remoteId: order.remoteId,
      orderId: String(order.id),
      platform: order.platform,
    })),
  )
  for (const row of remoteOrders) remoteOrderVersions.set(String(row.id), String(row.updated_at))
  reapplyRegistryPreview(
    isPromRegistryDraft.value,
    promRegistryEntries.value,
    applyPromRegistryPreview,
  )
  sortOrders()
  return refreshedAllRequestedOrders
}

function notifyNewOrder(order: Order) {
  const toast = {
    id: ++nextNewOrderToastId,
    text: `Новый заказ · ${orderBusinessPlatform(order)} · №${order.displayNumber ?? order.id}`,
  }
  newOrderToasts.value.push(toast)
  if (!audioContext || audioContext.state !== 'running') return
  try {
    const oscillator = audioContext.createOscillator()
    oscillator.connect(audioContext.destination)
    oscillator.start()
    oscillator.stop(audioContext.currentTime + 0.2)
  } catch {}
}

function unlockNewOrderSound() {
  if (!window.AudioContext) return
  audioContext ??= new window.AudioContext()
  void audioContext.resume().then(() => {
    if (audioContext?.state !== 'running') return
    stopAudioUnlockListeners.forEach((stop) => stop())
  })
}

async function reconcileRemoteOrders(force = false) {
  if (!supabase || isReconciliationRunning || (!force && documentVisibility.value !== 'visible'))
    return
  isReconciliationRunning = true
  try {
    const { data: remoteOrders, error } = await supabase.from('crm_orders').select('id, updated_at')
    if (error || !remoteOrders) {
      console.error('Не удалось сверить изменения заказов CRM:', error)
      return
    }
    const remoteIds = new Set(remoteOrders.map((order) => String(order.id)))
    const deletedRemoteIds = orders.value
      .map((order) => order.remoteId)
      .filter(
        (remoteId): remoteId is string => typeof remoteId === 'string' && !remoteIds.has(remoteId),
      )
    for (const remoteId of deletedRemoteIds) removeRemoteOrder(remoteId)
    const changedIds = remoteOrders
      .filter((order) => remoteOrderVersions.get(String(order.id)) !== String(order.updated_at))
      .map((order) => String(order.id))
    await refreshRemoteOrders(changedIds)
    lastReconciliationAt = Date.now()
  } finally {
    isReconciliationRunning = false
  }
}

async function loadRemoteOrders() {
  if (!supabase) return
  const { data: session } = await supabase.auth.getSession()
  if (!session.session) return
  user.value = session.session.user
  const { data: rateSetting } = await supabase
    .from('crm_settings')
    .select('numeric_value')
    .eq('key', 'usd_rate')
    .maybeSingle()
  if (rateSetting?.numeric_value) usdRate.value = Number(rateSetting.numeric_value)
  await refreshLinkedPriceProductKeys()
  const { data: remoteOrders } = await supabase
    .from('crm_orders')
    .select('*, crm_order_items(*)')
    .order('created_at', { ascending: false })
  const { data: orderItemReturns } = await supabase
    .from('crm_order_item_returns')
    .select('order_id, item_position, product_name, returned_quantity, returned_at')
  if (!remoteOrders?.length) {
    await persistOrders()
    return
  }
  registerRemoteOrders(
    remoteOrders.map((row) => ({
      remoteId: String(row.id),
      orderId: row.order_label ?? String(row.order_number),
      platform: row.platform as Platform,
    })),
  )
  orders.value = mapRemoteOrders(remoteOrders, orderItemReturns)
  for (const row of remoteOrders) remoteOrderVersions.set(String(row.id), String(row.updated_at))
  sortOrders()
}

onMounted(async () => {
  watch(documentVisibility, handleOrdersVisibilityChange)
  watch(isOnline, handleBrowserOnline)
  document.addEventListener('pointerdown', dismissNewOrderToastsOnPointerDown, true)
  await loadRemoteOrders()
  startAutomaticOrdersRefresh()
  const returnOrder = typeof route.query.returnOrder === 'string' ? route.query.returnOrder : ''
  const returnSearch = route.query.returnSearch
  if (route.query.returnRegistry === '1') restoreRegistryDraftNavigation()
  if (typeof returnSearch === 'string') searchQuery.value = returnSearch
  if (returnOrder && orders.value.some((order) => String(order.id) === returnOrder)) {
    expandedOrderId.value = returnOrder
    await nextTick()
    document.getElementById(`order-${returnOrder}`)?.scrollIntoView({ block: 'center' })
  }
  // This is a one-time return from the price list, not a permanent open-order state.
  if (route.query.returnOrder || route.query.returnSearch || route.query.returnRegistry)
    await router.replace({ query: {} })
})

onScopeDispose(() => {
  isAutomaticOrdersRefreshActive = false
  ordersRealtimeSubscribed.value = false
  if (realtimeRefreshTimer) window.clearTimeout(realtimeRefreshTimer)
  if (realtimeReconnectTimer) window.clearTimeout(realtimeReconnectTimer)
  if (reconciliationTimer) window.clearTimeout(reconciliationTimer)
  document.removeEventListener('pointerdown', dismissNewOrderToastsOnPointerDown, true)
  if (supabase && ordersRealtimeChannel) void supabase.removeChannel(ordersRealtimeChannel)
  if (audioContext) void audioContext.close()
})

function cloneOrder(order: Order) {
  return structuredClone(toRaw(order))
}

function openNewOrderDialog() {
  if (isGuest.value) return
  editingManualOrderId.value = null
  orderDraftError.value = ''
  orderDraft.value = createOrderDraft()
  orderDialog.value?.showModal()
}

function openEditOrderDialog(order: Order) {
  if (isGuest.value || order.externalId) return
  editingManualOrderId.value = order.remoteId ?? order.id
  orderDraftError.value = ''
  orderDraft.value = cloneOrder(order)
  orderDialog.value?.showModal()
}

function addProduct() {
  if (isGuest.value) return
  orderDraft.value.products.push(createProduct())
}

function removeProduct(productId: string) {
  if (isGuest.value) return
  if (orderDraft.value.products.length > 1) {
    orderDraft.value.products = orderDraft.value.products.filter(
      (product) => product.id !== productId,
    )
  }
}

function updateDraftPlatform() {
  const statuses = statusOptions[orderDraft.value.platform]
  if (!statuses.includes(orderDraft.value.status)) {
    orderDraft.value.status = statuses[0] ?? ''
  }
}

function normalizedOrderDraft() {
  const draft = cloneOrder(orderDraft.value)
  draft.customer = draft.customer.trim()
  draft.phone = draft.phone.trim()
  draft.delivery.recipient = draft.delivery.recipient.trim() || draft.customer
  draft.delivery.recipientPhone = draft.delivery.recipientPhone.trim() || draft.phone
  draft.products = draft.products.map((product) => ({
    ...product,
    name: product.name.trim(),
    size: product.size.trim(),
  }))
  return draft
}

function validateOrderDraft(order: Order) {
  if (!order.customer) return 'Укажите покупателя.'
  if (!order.phone) return 'Укажите телефон покупателя.'
  if (!order.date) return 'Укажите дату заказа.'
  if (!order.products.length) return 'Добавьте хотя бы один товар.'
  if (order.products.some((product) => !product.name)) return 'Укажите название каждого товара.'
  if (order.products.some((product) => !Number.isInteger(product.quantity) || product.quantity < 1))
    return 'Количество товара должно быть целым числом не меньше 1.'
  if (order.products.some((product) => !Number.isFinite(product.price) || product.price < 0))
    return 'Цена товара должна быть числом не меньше 0.'
  if (order.products.some((product) => !Number.isFinite(product.cost) || product.cost < 0))
    return 'Себестоимость товара должна быть числом не меньше 0.'
  return ''
}

function normalizedShipmentValue(value: string) {
  return value.replace(/\s/g, '').toLowerCase()
}

function normalizedDeliveryAddress(city: string, address: string) {
  return [city, address].filter(Boolean).join(', ').trim().replace(/\s+/g, ' ').toLowerCase()
}

function addUniqueLegacyValue(values: string[] | undefined, value: string) {
  const normalized = value.trim().replace(/\s+/g, ' ').toLowerCase()
  if (!normalized) return values ?? []
  const result = values ? [...values] : []
  if (!result.some((item) => item.trim().replace(/\s+/g, ' ').toLowerCase() === normalized))
    result.push(value)
  return result
}

function shipmentHistoryIdentity(entry: ShipmentHistoryEntry) {
  return normalizedShipmentValue(entry.ttn)
}

function shipmentHistoryRelationPriority(relation: ShipmentRelation) {
  const priority: Record<ShipmentRelation, number> = {
    original: 5,
    redirect: 4,
    return: 4,
    replacement: 3,
    unknown: 1,
  }
  return priority[relation]
}

function mergeShipmentHistoryEntry(
  current: ShipmentHistoryEntry,
  incoming: ShipmentHistoryEntry,
): ShipmentHistoryEntry {
  const incomingIsPreferred =
    shipmentHistoryRelationPriority(incoming.relation) >
    shipmentHistoryRelationPriority(current.relation)
  const preferred = incomingIsPreferred ? incoming : current
  const fallback = incomingIsPreferred ? current : incoming
  return {
    ...fallback,
    ...preferred,
    firstSeenAt: current.firstSeenAt || incoming.firstSeenAt,
    lastSeenAt: incoming.lastSeenAt || current.lastSeenAt,
  }
}

function appendShipmentHistory(
  history: ShipmentHistoryEntry[],
  entry: ShipmentHistoryEntry,
): ShipmentHistoryEntry[] {
  if (!entry.ttn.trim()) return history
  const identity = shipmentHistoryIdentity(entry)
  const index = history.findIndex((item) => shipmentHistoryIdentity(item) === identity)
  if (index < 0) return [...history, entry]
  const next = [...history]
  next[index] = mergeShipmentHistoryEntry(history[index]!, entry)
  return next
}

function manualShipmentSnapshot(
  delivery: Delivery,
  relation: ShipmentRelation,
  seenAt: string,
  relatedTtn = '',
): ShipmentHistoryEntry {
  return {
    ttn: delivery.ttn.trim(),
    carrier: delivery.carrier,
    relation,
    ...(relatedTtn ? { relatedTtn } : {}),
    ...(delivery.city.trim() ? { city: delivery.city.trim() } : {}),
    ...(delivery.address.trim() ? { address: delivery.address.trim() } : {}),
    ...(delivery.trackingDestinationBranchNumber
      ? { branchNumber: delivery.trackingDestinationBranchNumber }
      : {}),
    ...(delivery.trackingDestinationLocationCode
      ? { locationCode: delivery.trackingDestinationLocationCode }
      : {}),
    ...(delivery.trackingDestinationPostalCode
      ? { postalCode: delivery.trackingDestinationPostalCode }
      : {}),
    source: 'manual',
    firstSeenAt: seenAt,
    lastSeenAt: seenAt,
  }
}

function clearTrackingSnapshot(delivery: Delivery) {
  for (const key of Object.keys(delivery)) {
    if (key.startsWith('tracking')) delete (delivery as unknown as Record<string, unknown>)[key]
  }
}

function preserveManualDeliveryHistory(draft: Order, previousOrder: Order | null) {
  const seenAt = new Date().toISOString()
  const delivery = draft.delivery
  let history = [...(delivery.shipmentHistory ?? [])]
  if (!previousOrder) {
    if (delivery.ttn.trim()) {
      history = appendShipmentHistory(history, manualShipmentSnapshot(delivery, 'original', seenAt))
      delivery.shipmentHistory = history
    }
    return
  }

  const previous = previousOrder.delivery
  const previousTtn = previous.ttn.trim()
  const nextTtn = delivery.ttn.trim()
  const ttnChanged = normalizedShipmentValue(previousTtn) !== normalizedShipmentValue(nextTtn)
  const addressChanged =
    normalizedDeliveryAddress(previous.city, previous.address) !==
    normalizedDeliveryAddress(delivery.city, delivery.address)
  if (!ttnChanged && !addressChanged) return

  if (previousTtn) {
    const previousHistory = [...history]
      .reverse()
      .find((entry) => normalizedShipmentValue(entry.ttn) === normalizedShipmentValue(previousTtn))
    history = appendShipmentHistory(history, {
      ...manualShipmentSnapshot(
        previous,
        previousHistory?.relation ?? 'original',
        seenAt,
        previousHistory?.relatedTtn,
      ),
      source: previousHistory?.source ?? 'manual',
      firstSeenAt: previousHistory?.firstSeenAt ?? seenAt,
    })
  }

  const previousAddress = [previous.city, previous.address].filter(Boolean).join(', ')
  if (ttnChanged && previousTtn)
    delivery.ttnHistory = addUniqueLegacyValue(delivery.ttnHistory, previousTtn)
  if ((ttnChanged || addressChanged) && previousAddress)
    delivery.addressHistory = addUniqueLegacyValue(delivery.addressHistory, previousAddress)

  if (ttnChanged) clearTrackingSnapshot(delivery)
  if (nextTtn) {
    history = appendShipmentHistory(
      history,
      manualShipmentSnapshot(
        delivery,
        ttnChanged ? 'replacement' : 'unknown',
        seenAt,
        ttnChanged ? previousTtn : '',
      ),
    )
  }
  delivery.shipmentHistory = history
}

async function saveOrderDraft() {
  if (isGuest.value || isSavingOrderDraft.value) return

  isSavingOrderDraft.value = true
  orderDraftError.value = ''
  const editingId = editingManualOrderId.value
  let draft: Order | null = null
  let existingIndex = -1
  let previousOrder: Order | null = null

  try {
    draft = normalizedOrderDraft()
    const validationError = validateOrderDraft(draft)
    if (validationError) {
      orderDraftError.value = validationError
      return
    }

    existingIndex =
      editingId === null
        ? -1
        : orders.value.findIndex((order) => (order.remoteId ?? order.id) === editingId)
    const existingOrder = existingIndex >= 0 ? orders.value[existingIndex] : undefined
    previousOrder = existingOrder ? cloneOrder(existingOrder) : null
    preserveManualDeliveryHistory(draft, previousOrder)

    if (editingId !== null) {
      if (existingIndex < 0 || !previousOrder) throw new Error('Редактируемый заказ не найден.')
      if (previousOrder.externalId)
        throw new Error('Заказ маркетплейса нельзя редактировать вручную.')
      draft.remoteId = previousOrder.remoteId
      draft.externalId = previousOrder.externalId
      orders.value.splice(existingIndex, 1, draft)
      sortOrders()
      await persistOrders(draft)
    } else {
      orders.value.unshift(draft)
      await persistOrders(draft)
    }
    editingManualOrderId.value = null
    orderDialog.value?.close()
  } catch (error) {
    if (editingId !== null && previousOrder) {
      const rollbackIndex = orders.value.findIndex(
        (order) => (order.remoteId ?? order.id) === editingId,
      )
      if (rollbackIndex >= 0) orders.value.splice(rollbackIndex, 1, previousOrder)
      sortOrders()
    } else if (draft) {
      const rollbackIndex = orders.value.indexOf(draft)
      if (rollbackIndex >= 0) orders.value.splice(rollbackIndex, 1)
    }
    window.localStorage.setItem(storageKey, JSON.stringify(orders.value))
    orderDraftError.value = error instanceof Error ? error.message : 'Не удалось сохранить заказ.'
  } finally {
    isSavingOrderDraft.value = false
  }
}

function updateOrderStatus(order: Order, status: string) {
  if (isGuest.value) return
  order.status = status
  persistOrders(order)
}

function toggleOrder(orderId: string | number) {
  if (isPromRegistryDraft.value) {
    const isOpening = !expandedRegistryOrderIds.value.includes(orderId)
    expandedRegistryOrderIds.value = isOpening
      ? [...expandedRegistryOrderIds.value, orderId]
      : expandedRegistryOrderIds.value.filter((id) => id !== orderId)
    return
  }
  expandedOrderId.value = expandedOrderId.value === orderId ? null : orderId
}

function isOrderExpanded(order: Order) {
  return (
    expandedOrderId.value === order.id ||
    (isPromRegistryDraft.value && expandedRegistryOrderIds.value.includes(order.id))
  )
}

function handleOrderWorkspaceClick(order: Order, event: MouseEvent) {
  const target = event.target as HTMLElement
  if (target.closest('[data-order-card], button, input, select, textarea, a')) return
  toggleOrder(order.id)
}

function isInternalCommentVisible(order: Order) {
  return commentEditorOrderId.value === order.id || Boolean(order.internalComment?.trim())
}

function toggleInternalComment(order: Order) {
  if (isGuest.value) return
  if (order.internalComment?.trim()) {
    commentEditorOrderId.value = order.id
    return
  }
  commentEditorOrderId.value = commentEditorOrderId.value === order.id ? null : order.id
}

function internalCommentKey(order: Order) {
  return String(order.id)
}

function internalCommentValue(order: Order) {
  return editingInternalCommentOrderId.value === order.id
    ? (editingInternalCommentValue.value[internalCommentKey(order)] ?? '')
    : (order.internalComment ?? '')
}

function internalCommentRows(order: Order) {
  const lines = internalCommentValue(order)
    .split('\n')
    .filter((line) => line.trim()).length
  return Math.max(1, lines)
}

function updateInternalCommentDraft(order: Order, event: Event) {
  editingInternalCommentValue.value[internalCommentKey(order)] = (
    event.target as HTMLTextAreaElement
  ).value
}

function toggleInternalCommentEdit(order: Order) {
  if (isGuest.value) return
  const key = internalCommentKey(order)
  if (editingInternalCommentOrderId.value !== order.id) {
    editingInternalCommentOrderId.value = order.id
    editingInternalCommentValue.value[key] = order.internalComment ?? ''
    return
  }
  const value = (editingInternalCommentValue.value[key] ?? '').trim()
  order.internalComment = value || undefined
  editingInternalCommentOrderId.value = null
  delete editingInternalCommentValue.value[key]
  persistOrders(order)
  showSyncMessage('Комментарий к заказу сохранён.')
}

async function deleteOrder(order: Order) {
  if (isGuest.value || deletingOrderId.value !== null) return
  if (!window.confirm(`Удалить заказ № ${order.id} из CRM вместе со всеми позициями?`)) return
  deletingOrderId.value = order.id
  await persistenceQueue
  if (order.platform === 'Каста' && order.externalId) {
    if (!supabase) {
      window.alert('Не удалось сохранить запрет повторного импорта Kasta-заказа.')
      deletingOrderId.value = null
      return
    }
    const { error: tombstoneError } = await supabase.from('crm_deleted_marketplace_orders').upsert(
      {
        platform: 'Каста',
        external_id: order.externalId,
        order_label: order.displayNumber ?? String(order.id),
      },
      { onConflict: 'platform,external_id' },
    )
    if (tombstoneError) {
      window.alert(
        `Не удалось сохранить запрет повторного импорта Kasta-заказа: ${tombstoneError.message}`,
      )
      deletingOrderId.value = null
      return
    }
  }
  if (supabase && order.remoteId) {
    const { error: itemsError } = await supabase
      .from('crm_order_items')
      .delete()
      .eq('order_id', order.remoteId)
    const { error: orderError } = itemsError
      ? { error: itemsError }
      : await supabase.from('crm_orders').delete().eq('id', order.remoteId)
    if (orderError) {
      window.alert(`Не удалось удалить заказ: ${orderError.message}`)
      deletingOrderId.value = null
      return
    }
  }
  orders.value = orders.value.filter((item) => item.id !== order.id)
  window.localStorage.setItem(storageKey, JSON.stringify(orders.value))
  expandedOrderId.value = null
  deletingOrderId.value = null
}

function platformClass(platform: Platform) {
  return {
    'text-blue-700': platform === 'Пром',
    'text-orange-600': platform === 'Каста',
    'text-emerald-700': platform === 'Эпицентр',
  }
}

function displayOrderStatus(status: string) {
  const names: Record<string, string> = {
    pending: 'Новий',
    completed: 'Завершено',
    cancelled: 'Скасовано',
    received: 'Принято',
    delivered: 'Виконано',
    new: 'Новий',
    confirmed_by_seller: 'Підтверджено продавцем',
    confirmed_by_merchant: 'Підтверджено продавцем',
    confirmed: 'Підтверджено',
    sent: 'Відправлено',
    ready_for_pickup: 'Готово до видачі',
    finished: 'Завершено',
    closed: 'Закрито',
    canceled: 'Скасовано',
    returned: 'Повернено',
    return_request: 'Запит на повернення',
    canceled_by_seller: 'Скасовано продавцем',
    canceled_by_merchant: 'Скасовано продавцем',
  }
  return names[status.toLowerCase()] ?? status
}

function displayDeliveryStatus(status: string) {
  const normalized = status
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  const names: Record<string, string> = {
    initial: 'Заплановано',
    created: 'Запланировано',
    registered: 'Запланировано',
    planned: 'Запланировано',
    scheduled: 'Запланировано',
    pending: 'Запланировано',
    accepted: 'Готовится к отправке',
    confirmed: 'Готовится к отправке',
    processing: 'Готовится к отправке',
    ready_to_ship: 'Готовится к отправке',
    ready_for_shipment: 'Готовится к отправке',
    accepted_by_carrier: 'Отправлено',
    dispatched: 'Отправлено',
    sent: 'Отправлено',
    received: 'Получено',
    delivered: 'Получено',
    completed: 'Получено',
    in_transit: 'В дороге',
    in_delivery: 'В дороге',
    on_the_way: 'На шляху до одержувача',
    shipped: 'Отправлено',
    arrived: 'Готово к выдаче',
    arrived_at_branch: 'Готово к выдаче',
    at_pickup_point: 'Готово к выдаче',
    ready_for_delivery: 'Готово к выдаче',
    ready_for_pickup: 'Готово к выдаче',
    forwarding: 'Переадресовано',
    returning: 'Возвращается отправителю',
    return_to_sender: 'Возвращается отправителю',
    returned: 'Возвращено',
    canceled: 'Отменено',
    cancelled: 'Отменено',
    delivery_failed: 'Не доставлено',
    failed: 'Не доставлено',
    undelivered: 'Не доставлено',
    expired: 'Срок хранения истёк',
  }
  return (names[normalized] ?? status) || '—'
}

function promPaymentState(order: Order): 'paid' | 'unpaid' | 'error' | null {
  if (order.platform !== 'Пром') return null
  const status = normalizePaymentStatus(order.delivery.paymentStatus)
  if (
    isPaidPaymentStatus(status) ||
    (isPromPaymentMethod(order.delivery.paymentMethod) && isPaid(order))
  ) {
    return 'paid'
  }
  if (/^(?:payment_error|failed|declined)$/.test(status) || /(?:помил|ошиб)/i.test(status)) {
    return 'error'
  }
  if (
    /^(?:unpaid|not_paid|pending|waiting_for_payment|wait_for_payment)$/.test(status) ||
    /(?:не оплач|очіку|ожида)/i.test(status)
  )
    return 'unpaid'
  return null
}

function normalizePaymentStatus(status?: string) {
  return (
    status
      ?.trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_') ?? ''
  )
}

function isPaidPaymentStatus(status: string) {
  return /^(?:paid|paid_out|complete|completed|success|successful|settled|approved|оплачено)$/.test(
    status,
  )
}

function trackingUrl(delivery: Delivery) {
  const ttn = delivery.ttn.trim()
  if (!ttn) return ''
  const carrier = delivery.carrier.toLowerCase()
  const encodedTtn = encodeURIComponent(ttn)
  if (
    /^722-\d+$/.test(ttn.replace(/\s/g, '')) ||
    carrier.includes('cvz_epicentr') ||
    carrier.includes('parcel_box_epicentr')
  )
    return `https://ua.meest.com/parcel-track?parcel_number=${encodedTtn}`
  if (carrier.includes('нова') || carrier.includes('nova_poshta'))
    return `https://novaposhta.ua/tracking/${encodeURIComponent(ttn.replace(/\s/g, ''))}/`
  if (carrier.includes('rozetka'))
    return `https://rozetka.delivery/tracking/parcel?parcel_id=${encodedTtn}`
  if (carrier.includes('укр') || carrier.includes('ukrposhta'))
    return `https://track.ukrposhta.ua/?barcode=${encodeURIComponent(ttn.replace(/\s/g, ''))}`
  if (carrier.includes('meest') || carrier.includes('міст'))
    return `https://ua.meest.com/parcel-track?parcel_number=${encodedTtn}`
  return ''
}

function deliveryTtns(delivery: Delivery): string[] {
  const seen = new Set<string>()
  return [
    ...(delivery.ttnHistory ?? []),
    ...(delivery.shipmentHistory ?? []).map((entry) => entry.ttn),
    delivery.ttn,
  ].filter((ttn) => {
    const normalized = ttn.replace(/\s/g, '')
    if (!normalized || seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })
}

function deliveryStatusForOrder(order: Order) {
  if (order.delivery.trackingStatus?.trim())
    return displayDeliveryStatus(order.delivery.trackingStatus)
  // У Эпицентра «Завершено» означает, что отправление получено покупателем.
  // Это правило площадки, поэтому не показываем устаревшее «Запланировано».
  if (order.platform === 'Эпицентр' && displayOrderStatus(order.status) === 'Завершено')
    return 'Получено'
  return displayDeliveryStatus(order.delivery.status)
}

function statusOptionsForOrder(order: Order) {
  const options = statusOptions[order.platform] ?? []
  const currentStatus = displayOrderStatus(order.status)
  return options.includes(currentStatus) ? options : [currentStatus, ...options]
}

function carrierIcon(carrier: string): 'nova' | 'ukr' | 'rozetka' | 'meest' | 'generic' {
  const value = carrier.toLowerCase()
  const normalized = value.trim().replace(/[\s-]+/g, '_')
  if (value.includes('nova') || value.includes('новая') || value.includes('нова пошта'))
    return 'nova'
  if (value.includes('ukr') || value.includes('укр')) return 'ukr'
  if (value.includes('rozetka')) return 'rozetka'
  if (
    value.includes('meest') ||
    value.includes('міст') ||
    /^(?:cvz|pickup_point|collection_point)_epicent(?:e)?r$/.test(normalized) ||
    normalized === 'parcel_box_epicentr'
  )
    return 'meest'
  return 'generic'
}

function carrierLogoKind(order: Order) {
  const kind = carrierIcon(order.delivery.carrier)
  const carrier = order.delivery.carrier.toLowerCase()
  const address = order.delivery.address.toLowerCase()
  const isEpicentrDelivery = order.platform === 'Эпицентр'
  const isEpicentrCollectionPoint =
    isEpicentrDelivery && (carrier.includes('cvz') || /центр видачі|центр выдачи/.test(address))
  if (isEpicentrCollectionPoint) return 'meest-epicentr-cvz'
  if (isEpicentrDelivery && (kind === 'meest' || carrier.includes('parcel_box')))
    return 'meest-pachtmate'
  return kind
}

function displayPaymentMethod(method?: string) {
  if (!method) return '—'
  const normalized = method
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  const names: Record<string, string> = {
    monobank: 'Оплата через Монобанк',
    pay_on_delivery: 'Наложенный платёж',
    postpayment: 'Наложенный платёж',
    cash_on_delivery: 'Наложенный платёж',
    cod: 'Наложенный платёж',
    prepayment: 'Предоплата',
    online: 'Онлайн-оплата',
    online_payment: 'Онлайн-оплата',
    card: 'Оплата картой',
    card_payment: 'Оплата картой',
    bnpl: 'Рассрочка',
    оплата_картой: 'Оплата картой',
    оплата_через_monobank: 'Оплата через Монобанк',
    оплата_через_монобанк: 'Оплата через Монобанк',
    cash: 'Наличными',
    invoice: 'Оплата по счёту',
    prom_payment: 'Пром-оплата',
    prom_oplata: 'Пром-оплата',
    prompayment: 'Пром-оплата',
    promoplata: 'Пром-оплата',
  }
  return names[normalized] ?? method
}

function orderHeaderPaymentLabel(order: Order) {
  if (!isDeliveryPaymentPaid(order)) return ''
  const method =
    order.delivery.paymentMethod
      ?.trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_') ?? ''
  if (order.platform === 'Каста' && method === 'bnpl') return 'Рассрочка'
  if (
    order.platform === 'Каста' &&
    /^(?:card|card_payment|online|online_payment|оплата_картой)$/.test(method)
  ) {
    return 'Оплата картой'
  }
  if (
    order.platform === 'Эпицентр' &&
    /^(?:monobank|оплата_через_monobank|оплата_через_монобанк)$/.test(method)
  )
    return 'Оплата Monobank'
  return ''
}

function isPromPaymentMethod(method?: string) {
  const normalized =
    method
      ?.trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, '') ?? ''
  return (
    normalized.includes('промоплат') ||
    normalized.includes('promoplat') ||
    normalized === 'prompayment'
  )
}

function isDeliveryPaymentPaid(order: Order) {
  const status = normalizePaymentStatus(order.delivery.paymentStatus)
  if (
    /^(?:unpaid|not_paid|payment_error|failed|declined|pending|waiting_for_payment|wait_for_payment)$/.test(
      status,
    )
  )
    return false
  if (isPaidPaymentStatus(status)) return true
  const method =
    order.delivery.paymentMethod
      ?.trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_') ?? ''
  if (/^(?:pay_on_delivery|postpayment|cash_on_delivery|cod)$/.test(method)) return false
  if (isPromPaymentMethod(order.delivery.paymentMethod)) return isPaid(order)
  return /^(?:monobank|prepayment|online|online_payment|card|card_payment|bnpl|оплата_картой|оплата_через_monobank|оплата_через_монобанк)$/.test(
    method,
  )
}

function shipmentHistoryAddress(entry: ShipmentHistoryEntry) {
  return displayDeliveryAddress(entry.city ?? '', entry.address ?? '')
}

function previousShipmentHistory(delivery: Delivery) {
  const currentTtn = normalizedShipmentValue(delivery.ttn)
  const normalizedHistory = (delivery.shipmentHistory ?? []).reduce(
    (history, entry) => appendShipmentHistory(history, entry),
    [] as ShipmentHistoryEntry[],
  )
  return normalizedHistory
    .filter((entry) => normalizedShipmentValue(entry.ttn) !== currentTtn)
    .reverse()
}

function legacyPreviousTtns(delivery: Delivery) {
  const represented = new Set([
    normalizedShipmentValue(delivery.ttn),
    ...(delivery.shipmentHistory ?? []).map((entry) => normalizedShipmentValue(entry.ttn)),
  ])
  return (delivery.ttnHistory ?? []).filter((ttn) => {
    const normalized = normalizedShipmentValue(ttn)
    return normalized && !represented.has(normalized)
  })
}

function legacyPreviousAddresses(delivery: Delivery) {
  const represented = new Set([
    normalizedDeliveryAddress(delivery.city, delivery.address),
    ...(delivery.shipmentHistory ?? []).map((entry) =>
      normalizedDeliveryAddress(entry.city ?? '', entry.address ?? ''),
    ),
  ])
  return (delivery.addressHistory ?? []).filter((address) => {
    const normalized = address.trim().replace(/\s+/g, ' ').toLowerCase()
    return normalized && !represented.has(normalized)
  })
}

function hasDeliveryHistory(delivery: Delivery) {
  return previousShipmentHistory(delivery).length > 0 || legacyPreviousTtns(delivery).length > 0
}

function deliveryWasRedirected(delivery: Delivery) {
  return (delivery.shipmentHistory ?? []).some((entry) => entry.relation === 'redirect')
}

function shipmentRelationLabel(relation: ShipmentRelation) {
  const labels: Record<ShipmentRelation, string> = {
    original: 'Первоначальная ТТН',
    redirect: 'Переадресация',
    return: 'Возврат',
    replacement: 'Замена ТТН',
    unknown: 'Связь не определена',
  }
  return labels[relation]
}

const spreadsheetNumberFormatter = new Intl.NumberFormat('uk-UA', {
  maximumFractionDigits: 2,
  useGrouping: false,
})

function formatSpreadsheetNumber(value: number) {
  return spreadsheetNumberFormatter.format(value)
}

function spreadsheetProductLabel(product: OrderProduct) {
  const productName = [product.name.trim(), product.size.trim()].filter(Boolean).join(' ')
  return `${productName} × ${getRemainingQuantity(product)}`
}

function spreadsheetOrderComment(order: Order) {
  const paymentMethod = displayPaymentMethod(order.delivery.paymentMethod)
  const ttn = order.delivery.ttn
    ? deliveryTtnForClipboard(order.delivery.carrier, order.delivery.ttn)
    : ''
  return [paymentMethod === '—' ? '' : paymentMethod, ttn, order.displayNumber ?? String(order.id)]
    .filter(Boolean)
    .join(' ')
}

function spreadsheetPlatformLabel(order: Order) {
  const platform = orderBusinessPlatform(order)
  return platform === 'Эпицентр' ? 'Эпик' : platform
}

async function copyOrderNumber(order: Order) {
  if (!isClipboardSupported.value) return
  try {
    await copy(order.displayNumber ?? String(order.id))
    if (copied.value) showInlineActionNotice(`copy-order:${order.id}`, 'Скопировано')
  } catch {}
}

async function copyOrderForSpreadsheet(order: Order) {
  if (!isClipboardSupported.value) return

  const products = order.products
    .filter((product) => getRemainingQuantity(product) > 0)
    .map(spreadsheetProductLabel)
    .join(', ')
  const cells = [
    order.date,
    spreadsheetPlatformLabel(order),
    products,
    formatSpreadsheetNumber(getNetOrderCost(order)),
    formatSpreadsheetNumber(getNetOrderAmount(order)),
    '',
    formatSpreadsheetNumber(getNetRoyalty(order)),
    formatSpreadsheetNumber(order.shipping),
    '',
    '',
    '',
    spreadsheetOrderComment(order),
  ]

  try {
    await copy(cells.join('\t'))
    markSpreadsheetOrderCopied(order)
    if (copied.value) showInlineActionNotice(`copy-excel:${order.id}`, 'Строка скопирована')
  } catch {}
}

function oneCClipboardText(delivery: Delivery) {
  const ttn = deliveryTtnForClipboard(delivery.carrier, delivery.ttn).trim()
  if (!ttn) return ''

  switch (carrierIcon(delivery.carrier)) {
    case 'nova':
      return `дроп ${ttn}`
    case 'rozetka':
      return `дроп Розетка ${ttn}`
    case 'meest':
      return `дроп Мист ${ttn}`
    case 'ukr':
      return `дроп Укрпочта ${ttn}  (068-565-55-52)`
    default:
      return ''
  }
}

async function copyTtn(delivery: Delivery, orderId: Order['id']) {
  if (!delivery.ttn || !isClipboardSupported.value) return
  try {
    await copy(deliveryTtnForClipboard(delivery.carrier, delivery.ttn))
    if (copied.value) showInlineActionNotice(`copy-ttn:${orderId}`, 'Скопировано')
  } catch {}
}

async function copyOneCTemplate(delivery: Delivery, orderId: Order['id']) {
  if (!isClipboardSupported.value) return
  const text = oneCClipboardText(delivery)
  if (!text) return

  try {
    await copy(text)
    if (copied.value) showInlineActionNotice(`copy-1c:${orderId}`, 'Скопировано')
  } catch {}
}

function openEpicentrOrder(order: Order) {
  if (!order.externalId) return
  closePrintRegistry()
  window.open(
    `https://admin.epicentrm.com.ua/oms/orders/${order.externalId}`,
    '_blank',
    'noopener,noreferrer',
  )
}

function openPromOrder(order: Order) {
  const promId = String(order.externalId ?? order.id).replace(/^prom:/, '')
  if (!promId) return
  closePrintRegistry()
  window.open(`https://my.prom.ua/cms/order/edit/${promId}`, '_blank', 'noopener,noreferrer')
}

function openKastaOrder(order: Order) {
  const kastaId = String(order.externalId ?? order.id).replace(/^kasta:/, '')
  if (!kastaId) return
  closePrintRegistry()
  window.open(
    `https://hub.kasta.ua/customer-orders/all?order=${encodeURIComponent(kastaId)}`,
    '_blank',
    'noopener,noreferrer',
  )
}

function syncProductRoyaltyAmount(order: Order, product: OrderProduct) {
  product.royaltyManual = true
  product.royaltyAmount = product.price * product.quantity * ((product.royaltyPercent ?? 0) / 100)
  persistOrders(order)
}

function syncProductRoyaltyPercent(order: Order, product: OrderProduct) {
  product.royaltyManual = true
  const amount = product.price * product.quantity
  product.royaltyPercent = amount === 0 ? 0 : ((product.royaltyAmount ?? 0) / amount) * 100
  persistOrders(order)
}

function syncAcquiringAmount(order: Order) {
  order.acquiring = getOrderAmount(order) * ((order.acquiringPercent ?? 0) / 100)
  persistOrders(order)
}

function syncAcquiringPercent(order: Order) {
  const amount = getOrderAmount(order)
  order.acquiringPercent = amount === 0 ? 0 : (order.acquiring / amount) * 100
  persistOrders(order)
}

function parseOrderNumber(event: Event) {
  const value = Number((event.target as HTMLInputElement).value.replace(',', '.'))
  return Number.isFinite(value) ? value : 0
}

function updateProductRoyaltyPercent(product: OrderProduct, key: string, event: Event) {
  const raw = (event.target as HTMLInputElement).value
  editingOrderValue.value[key] = raw
  product.royaltyPercent = parseOrderNumber(event)
  product.royaltyManual = true
  product.royaltyAmount = product.price * product.quantity * ((product.royaltyPercent ?? 0) / 100)
}

function updateProductRoyaltyAmount(product: OrderProduct, key: string, event: Event) {
  const raw = (event.target as HTMLInputElement).value
  editingOrderValue.value[key] = raw
  product.royaltyAmount = parseOrderNumber(event)
  product.royaltyManual = true
  const amount = product.price * product.quantity
  product.royaltyPercent = amount === 0 ? 0 : ((product.royaltyAmount ?? 0) / amount) * 100
}

function orderCellValue(key: string, value: number | undefined) {
  return editingOrderValue.value[key] ?? formatOrderNumber(value)
}

function financialOrderCellValue(key: string, value: number | undefined) {
  return editingOrderValue.value[key] ?? (value ?? 0).toFixed(2).replace('.', ',')
}

function updateOrderFinancial(
  order: Order,
  field: 'shipping' | 'paymentAmount' | 'acquiring' | 'acquiringPercent' | 'extraExpenses',
  key: string,
  event: Event,
) {
  const raw = (event.target as HTMLInputElement).value
  editingOrderValue.value[key] = raw
  const value = Number(raw.replace(',', '.'))
  if (Number.isFinite(value)) {
    order[field] = value
    if (field === 'shipping') order.delivery.shippingSource = 'manual'
    if (field === 'acquiringPercent') order.acquiring = getOrderAmount(order) * (value / 100)
    if (field === 'acquiring') {
      const amount = getOrderAmount(order)
      order.acquiringPercent = amount === 0 ? 0 : (value / amount) * 100
    }
  }
}

function orderFromEditKey(key: string) {
  return orders.value.find((order) => key.startsWith(`${order.id}-`))
}

async function toggleOrderCell(key: string, event: KeyboardEvent, onCommit?: () => void) {
  if (isGuest.value) return
  const order = orderFromEditKey(key)
  if (editingOrderCell.value === key) {
    onCommit?.()
    editingOrderCell.value = null
    delete editingOrderValue.value[key]
    persistOrders(order)
    return
  }
  editingOrderCell.value = key
  editingOrderValue.value[key] = (event.target as HTMLInputElement).value
  await nextTick()
  ;(event.target as HTMLInputElement).select()
}

function updateOrderNumber(
  product: OrderProduct,
  field: 'quantity' | 'price' | 'cost' | 'costUsd',
  key: string,
  event: Event,
) {
  const raw = (event.target as HTMLInputElement).value
  editingOrderValue.value[key] = raw
  const value = Number(raw.replace(',', '.'))
  if (!Number.isFinite(value)) return
  if (field === 'costUsd') {
    product.costManual = true
    product.costUsd = value
    if (value !== 0) product.cost = value * usdRate.value
    return
  }
  product[field] = value
  if (field === 'cost') {
    product.costManual = true
    product.costUsd = 0
  }
}

function flushDeferredRemoteOrder(order: Order | undefined) {
  const remoteId = order?.remoteId
  if (!remoteId || !deferredRemoteOrderIds.delete(remoteId)) return
  queueRemoteOrderRefresh(remoteId)
}

function finishOrderCell(key: string, onCommit?: () => void) {
  const order = orderFromEditKey(key)
  if (editingOrderCell.value === key) {
    onCommit?.()
    editingOrderCell.value = null
    delete editingOrderValue.value[key]
    persistOrders(order)
  }
  flushDeferredRemoteOrder(order)
}

function orderDateTime(order: Order) {
  const [day, month, year] = order.date.split('.').map(Number)
  const [hours, minutes] = (order.time ?? '00:00').split(':').map(Number)
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1, hours ?? 0, minutes ?? 0).getTime()
}
</script>

<template>
  <div
    v-if="!user"
    class="flex min-h-screen items-center justify-center bg-slate-50 p-4 text-slate-900"
  >
    <form
      class="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-xl"
      @submit.prevent="signIn"
    >
      <p class="text-xs font-bold tracking-[0.2em] text-emerald-700">SPECMARKET CRM</p>
      <h1 class="mt-3 text-3xl font-semibold">Вход в CRM</h1>
      <p class="mt-2 text-sm text-slate-500">
        Войди, чтобы увидеть общие заказы и цены на всех устройствах.
      </p>
      <input
        v-model="email"
        required
        class="mt-6 w-full rounded-xl border border-slate-200 px-3 py-3"
        placeholder="Email"
        type="email"
      />
      <div class="relative mt-3">
        <input
          v-model="password"
          required
          class="w-full rounded-xl border border-slate-200 px-3 py-3 pr-12"
          placeholder="Пароль"
          :type="showPassword ? 'text' : 'password'"
        /><button
          class="absolute inset-y-0 right-0 px-4 text-slate-500 hover:text-emerald-700"
          type="button"
          @click="showPassword = !showPassword"
        >
          {{ showPassword ? 'Скрыть' : 'Показать' }}
        </button>
      </div>
      <p v-if="authError" class="mt-3 text-sm text-rose-700">{{ authError }}</p>
      <button
        class="mt-5 w-full rounded-xl bg-emerald-700 px-4 py-3 font-semibold text-white hover:bg-emerald-800"
        :disabled="isSigningIn"
        type="submit"
      >
        {{ isSigningIn ? 'Входим…' : 'Войти' }}
      </button>
    </form>
  </div>
  <div v-else class="min-h-screen bg-slate-50 text-slate-900">
    <div
      class="pointer-events-none fixed inset-x-0 top-4 z-50 mx-auto flex max-w-md flex-col gap-2 px-4"
    >
      <p
        v-for="toast in newOrderToasts"
        :key="toast.id"
        class="rounded-xl bg-slate-900 px-4 py-3 text-center text-sm font-semibold text-white shadow-lg"
      >
        {{ toast.text }}
      </p>
    </div>
    <RouterLink
      class="fixed right-0 top-1/2 z-[80] flex -translate-y-1/2 cursor-pointer flex-col items-center gap-0.5 rounded-l-xl border border-emerald-300 bg-white px-2 py-3 text-sm font-bold leading-none text-emerald-800 shadow-lg transition hover:bg-emerald-50"
      :to="{
        path: '/prices',
        query: {
          ...(expandedOrderId ? { returnOrder: expandedOrderId } : {}),
          ...(searchQuery ? { returnSearch: searchQuery } : {}),
          ...(isPromRegistryDraft ? { returnRegistry: '1' } : {}),
        },
      }"
      title="Открыть цены и себестоимость"
      ><span>Ц</span><span>Е</span><span>Н</span><span>Ы</span></RouterLink
    >
    <button
      v-if="visibleOrders.length > 0 && windowScrollY > 320"
      class="fixed bottom-5 left-5 z-[85] flex size-12 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 shadow-lg transition hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-800"
      type="button"
      title="Наверх"
      aria-label="Наверх"
      @click="scrollOrdersToTop"
    >
      <ArrowUp class="size-5" aria-hidden="true" />
    </button>
    <div class="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header class="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div class="shrink-0">
          <p class="text-xs font-bold tracking-[0.2em] text-emerald-700">SPECMARKET CRM</p>
          <h1 class="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Заказы</h1>
          <div
            class="mt-2 inline-flex items-center gap-2 text-xs font-semibold"
            :class="{
              'text-emerald-700': ordersRealtimeSubscribed,
              'text-red-700': !ordersRealtimeSubscribed,
            }"
          >
            <span
              class="size-2 rounded-full"
              :class="{
                'bg-emerald-500': ordersRealtimeSubscribed,
                'bg-red-500': !ordersRealtimeSubscribed,
              }"
              aria-hidden="true"
            ></span>
            {{ ordersRealtimeSubscribed ? 'Онлайн' : 'Нет обновления' }}
          </div>
        </div>
        <div class="flex flex-wrap items-center justify-end gap-2 xl:flex-nowrap">
          <button
            v-if="!isGuest"
            class="whitespace-nowrap rounded-xl border border-violet-200 bg-white px-3 py-2.5 text-sm font-semibold text-violet-700 shadow-sm transition hover:bg-violet-50"
            type="button"
            @click="!isGuest && openPromRegistryFilePicker()"
          >
            <Upload class="size-4" aria-hidden="true" /> Импортировать реестр
          </button>
          <button
            v-if="!isGuest"
            class="whitespace-nowrap rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-900 shadow-sm transition hover:bg-amber-100 disabled:cursor-wait disabled:opacity-60"
            :disabled="isPreparingPrintRegistry"
            type="button"
            @click="openPrintRegistry"
          >
            {{ isPreparingPrintRegistry ? 'Проверяем ТТН…' : 'Реестр печати' }}
          </button>
          <RouterLink
            class="whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-emerald-300 hover:text-emerald-800"
            to="/prices"
          >
            Цены
          </RouterLink>
          <button
            v-if="!isGuest"
            class="whitespace-nowrap rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm font-semibold text-sky-800 shadow-sm transition hover:bg-sky-100 disabled:cursor-wait disabled:opacity-60"
            :disabled="isMarketplaceSyncBusy"
            type="button"
            @click="syncNewAllPlatforms"
          >
            <RefreshCw
              class="mr-1 inline size-4"
              :class="{ 'animate-spin': isSyncingAllPlatforms }"
              aria-hidden="true"
            />
            {{ isSyncingAllPlatforms ? 'Синхронизация…' : 'Новые заказы' }}
          </button>
          <button
            v-if="!isGuest"
            class="whitespace-nowrap rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5 text-sm font-semibold text-violet-800 shadow-sm transition hover:bg-violet-100 disabled:cursor-wait disabled:opacity-60"
            :disabled="isSyncingDelivery"
            type="button"
            @click="syncDeliveryTracking"
          >
            <RefreshCw
              class="mr-1 inline size-4"
              :class="{ 'animate-spin': isSyncingDelivery }"
              aria-hidden="true"
            />
            {{ isSyncingDelivery ? 'Обновление…' : 'Доставки' }}
          </button>
          <button
            v-if="!isGuest"
            class="whitespace-nowrap rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2.5 text-sm font-semibold text-indigo-800 shadow-sm transition hover:bg-indigo-100 disabled:cursor-wait disabled:opacity-60"
            :disabled="isMarketplaceSyncBusy"
            type="button"
            @click="syncFullAllPlatforms"
          >
            <RefreshCw
              class="mr-1 inline size-4"
              :class="{ 'animate-spin': isSyncingAllPlatforms }"
              aria-hidden="true"
            />
            {{ isSyncingAllPlatforms ? 'Синхронизация…' : 'Полная синхронизация' }}
          </button>
          <button
            v-if="!isGuest"
            class="whitespace-nowrap rounded-xl bg-emerald-700 px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800"
            type="button"
            @click="openNewOrderDialog"
          >
            <Plus class="mr-1 inline size-4" aria-hidden="true" /> Новый заказ
          </button>
          <button
            class="ml-1 grid size-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white shadow-sm transition hover:border-sky-300 hover:bg-sky-50"
            type="button"
            title="Выйти"
            aria-label="Выйти"
            @click="signOut"
          >
            <LogOut class="size-5" aria-hidden="true" />
          </button>
        </div>
      </header>
      <p
        v-if="isGuest"
        class="mt-5 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-medium text-sky-900"
      >
        Гостевой режим: доступен только просмотр данных.
      </p>
      <p
        v-else-if="syncEpicentrMessage"
        class="mt-5 whitespace-pre-line rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900 transition-opacity duration-500"
        :class="syncNoticeVisible ? 'opacity-100' : 'opacity-0'"
      >
        {{ syncEpicentrMessage }}
      </p>
      <p
        v-if="promRegistryError"
        class="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800"
      >
        {{ promRegistryError }}
      </p>
      <section
        v-if="isPromRegistryView"
        class="mt-5 rounded-2xl border border-violet-200 bg-violet-50 p-4 shadow-sm"
      >
        <div>
          <p class="font-semibold text-violet-950">
            Реестр {{ registrySourceLabel }}: {{ promRegistryFileName }}
          </p>
          <p class="mt-1 text-sm text-violet-800">
            Заказов в реестре: {{ promRegistryEntries.length }} · найдено в CRM:
            {{ promRegistryOrders.length }} · не найдено:
            {{ unmatchedPromRegistryEntries.length }}
          </p>
          <p class="mt-1 text-sm text-violet-800">
            {{ registrySource === 'Kasta' ? 'Сумма оплат по заказам CRM' : 'Сумма реестра' }}:
            {{ formatMoney(promRegistryTotals.paymentAmount) }} · эквайринг:
            {{ formatMoney(promRegistryTotals.acquiring) }} · к зачислению:
            {{ formatMoney(promRegistryNetTotal) }}
          </p>
        </div>
        <p
          v-if="unmatchedPromRegistryEntries.length"
          class="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800"
        >
          Не найдены в CRM: {{ unmatchedPromRegistryOrderNumbers }}
        </p>
        <p v-if="isPromRegistryDraft" class="mt-3 text-sm font-medium text-violet-900">
          Это черновик: сумма оплаты и эквайринг попадут в CRM только после подтверждения. Остальные
          поля заказа сохраняются сразу.
        </p>
        <p
          v-if="
            isPromRegistryDraft &&
            (promRegistryExistingFinancials.complete || promRegistryExistingFinancials.partial)
          "
          class="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900"
        >
          Уже было заполнено: {{ promRegistryExistingFinancials.complete }} из
          {{ promRegistryOrders.length }} полностью · {{ promRegistryExistingFinancials.partial }}
          частично. Сиреневым отмечены поля, которые изменил этот черновик.
        </p>
        <p
          v-if="isPromRegistryDraft && promRegistryMismatchCount"
          class="mt-3 rounded-xl border border-amber-300 bg-amber-100 px-3 py-2 text-sm font-medium text-amber-950"
        >
          Расхождений с {{ registrySourceLabel }}: {{ promRegistryMismatchCount }}. Такие поля
          отмечены янтарным и не будут заменены автоматически.
        </p>
      </section>

      <section
        class="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-[0.58fr_1.04fr_1.19fr_1.05fr_0.85fr]"
      >
        <article
          class="grid grid-cols-[auto_auto_auto] items-center justify-start gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm"
        >
          <p class="text-sm font-medium text-slate-600">Заказы</p>
          <div class="border-l border-slate-300 pl-2 text-left">
            <p class="text-[10px] uppercase text-slate-400">Сегодня</p>
            <p class="text-xl font-semibold leading-none">{{ summary.today.orders }}</p>
          </div>
          <div class="border-l border-slate-300 pl-2 text-left">
            <p class="text-[10px] uppercase text-slate-400">{{ orderListPeriodLabel }}</p>
            <p class="text-xl font-semibold leading-none">{{ summary.period.orders }}</p>
          </div>
          <div
            v-if="isComparingPreviousPeriod"
            class="col-span-full -mx-3 -mb-2 flex items-center justify-between border-t border-indigo-100 bg-indigo-50 px-3 py-1.5 text-xs text-indigo-700"
          >
            <span>{{ previousOrderListRangeLabel }}</span>
            <strong>{{ summary.previous.orders }}</strong>
          </div>
        </article>
        <article
          class="grid grid-cols-[auto_auto_auto] items-center justify-start gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm"
        >
          <p class="text-sm font-medium text-slate-600">Оборот</p>
          <div class="border-l border-slate-300 pl-2 text-left">
            <p class="text-[10px] uppercase text-slate-400">Сегодня</p>
            <p class="whitespace-nowrap text-lg font-semibold leading-none">
              {{ formatMoney(summary.today.turnover) }}
            </p>
          </div>
          <div class="border-l border-slate-300 pl-2 text-left">
            <p class="text-[10px] uppercase text-slate-400">{{ orderListPeriodLabel }}</p>
            <p class="whitespace-nowrap text-lg font-semibold leading-none">
              {{ formatMoney(summary.period.turnover) }}
            </p>
          </div>
          <div
            v-if="isComparingPreviousPeriod"
            class="col-span-full -mx-3 -mb-2 flex items-center justify-between border-t border-indigo-100 bg-indigo-50 px-3 py-1.5 text-xs text-indigo-700"
          >
            <span>{{ previousOrderListRangeLabel }}</span>
            <strong>{{ formatMoney(summary.previous.turnover) }}</strong>
          </div>
        </article>
        <article
          class="grid grid-cols-[auto_auto_auto] items-center justify-start gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm"
        >
          <p class="max-w-28 text-sm font-medium leading-tight text-slate-600">Плановая прибыль</p>
          <div class="border-l border-slate-300 pl-2 text-left">
            <p class="text-[10px] uppercase text-slate-400">Сегодня</p>
            <p class="whitespace-nowrap text-lg font-semibold leading-none">
              {{ formatMoney(summary.today.planned) }}
            </p>
          </div>
          <div class="border-l border-slate-300 pl-2 text-left">
            <p class="text-[10px] uppercase text-slate-400">{{ orderListPeriodLabel }}</p>
            <p class="whitespace-nowrap text-lg font-semibold leading-none">
              {{ formatMoney(summary.period.planned) }}
            </p>
          </div>
          <div
            v-if="isComparingPreviousPeriod"
            class="col-span-full -mx-3 -mb-2 flex items-center justify-between border-t border-indigo-100 bg-indigo-50 px-3 py-1.5 text-xs text-indigo-700"
          >
            <span>{{ previousOrderListRangeLabel }}</span>
            <strong>{{ formatMoney(summary.previous.planned) }}</strong>
          </div>
        </article>
        <article
          class="grid grid-cols-[auto_auto] items-center justify-start gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm"
        >
          <p class="max-w-28 text-sm font-medium leading-tight text-slate-600">
            Фактическая прибыль
          </p>
          <div class="border-l border-slate-300 pl-2 text-left">
            <p class="text-[10px] uppercase text-slate-400">{{ orderListPeriodLabel }}</p>
            <p class="whitespace-nowrap text-lg font-semibold leading-none">
              {{ formatMoney(summary.period.actual) }}
            </p>
          </div>
          <div
            v-if="isComparingPreviousPeriod"
            class="col-span-full -mx-3 -mb-2 flex items-center justify-between border-t border-indigo-100 bg-indigo-50 px-3 py-1.5 text-xs text-indigo-700"
          >
            <span>{{ previousOrderListRangeLabel }}</span>
            <strong>{{ formatMoney(summary.previous.actual) }}</strong>
          </div>
        </article>
        <article
          class="grid grid-cols-[auto_auto] items-center justify-start gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm"
        >
          <p class="text-sm font-medium text-slate-600">В дороге</p>
          <div class="border-l border-slate-300 pl-2 text-left">
            <p class="whitespace-nowrap text-lg font-semibold leading-none">
              {{ formatMoney(unpaidShipmentAmount) }}
            </p>
          </div>
        </article>
      </section>

      <section class="mt-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div class="flex items-center justify-between gap-3">
          <button
            class="flex items-center gap-2 text-sm font-semibold text-slate-700 hover:text-slate-950"
            type="button"
            :aria-expanded="isPlatformSummaryExpanded"
            @click="isPlatformSummaryExpanded = !isPlatformSummaryExpanded"
          >
            <span>По площадкам</span>
            <ChevronDown
              class="size-4 transition-transform"
              :class="{ 'rotate-180': isPlatformSummaryExpanded }"
              aria-hidden="true"
            />
          </button>
          <div v-if="isPlatformSummaryExpanded" class="flex min-w-0 items-center justify-end gap-2">
            <select
              v-model="platformSummaryPeriod"
              class="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700"
              aria-label="Период статистики по площадкам"
            >
              <option value="week">Неделя</option>
              <option value="decade">Декада</option>
              <option value="month">Месяц</option>
              <option value="last30">Последние 30 дней</option>
              <option value="custom">Произвольный период</option>
            </select>
            <template v-if="platformSummaryPeriod === 'custom'">
              <span class="text-xs text-slate-400">с</span>
              <input
                v-model="platformSummaryFrom"
                class="h-8 w-32 rounded-lg border border-slate-200 px-2 text-xs"
                type="date"
                aria-label="Начало периода"
              />
              <span class="text-xs text-slate-400">по</span>
              <input
                v-model="platformSummaryTo"
                class="h-8 w-32 rounded-lg border border-slate-200 px-2 text-xs"
                type="date"
                aria-label="Конец периода"
              />
            </template>
          </div>
        </div>
        <div
          v-if="isPlatformSummaryExpanded"
          class="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-[1.25fr_1.2fr_1.1fr_0.68fr_0.68fr]"
        >
          <article
            v-for="item in platformSummary"
            :key="item.platform"
            class="grid grid-cols-[1fr_auto] items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
            :class="{ 'lg:border-l-2 lg:border-l-slate-400': item.platform === 'Р/С' }"
          >
            <div class="min-w-0 whitespace-nowrap text-[11px] leading-4 text-slate-500">
              <p>
                Заказы: <b class="text-slate-800">{{ item.count }}</b>
              </p>
              <p>
                Оборот: <b class="text-slate-800">{{ formatMoney(item.turnover) }}</b>
              </p>
              <p>
                План: <b class="text-slate-800">{{ formatMoney(item.planned) }}</b>
              </p>
              <p>
                Факт: <b class="text-slate-800">{{ formatMoney(item.actual) }}</b>
              </p>
            </div>
            <div class="flex min-w-20 justify-end font-bold">
              <PlatformLogo :platform="item.platform" />
            </div>
          </article>
        </div>
      </section>

      <section class="mt-3 rounded-2xl border-2 border-slate-300 bg-slate-100 p-3 shadow-sm">
        <div
          class="flex flex-col gap-3 rounded-xl border border-slate-300 bg-white p-4 sm:flex-row sm:flex-wrap"
        >
          <div class="relative w-full sm:max-w-md">
            <Search
              class="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-slate-500"
              aria-hidden="true"
            />
            <input
              v-model="searchQuery"
              class="w-full rounded-xl border-2 border-emerald-400 bg-white py-2 pl-10 pr-10 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
              placeholder="Поиск: заказ, ТТН, покупатель, товар, оплата"
            />
            <button
              v-if="searchQuery"
              class="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-700"
              type="button"
              aria-label="Очистить поиск"
              @click="searchQuery = ''"
            >
              <X class="size-4" aria-hidden="true" />
            </button>
          </div>
          <select
            v-model="platformFilter"
            class="rounded-xl border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="all">Все площадки</option>
            <option v-for="platform in platformOptions" :key="platform" :value="platform">
              {{ platform }}
            </option>
          </select>
          <button
            class="rounded-xl border px-3 py-2 text-sm font-semibold transition"
            :class="
              isShowingCancelledAndReturned
                ? 'border-rose-500 bg-rose-50 text-rose-700'
                : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
            "
            type="button"
            @click="toggleCancelledAndReturned"
          >
            Отмены и возвраты
          </button>
          <div class="flex items-center gap-2 sm:ml-auto">
            <label
              class="inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1.5 text-xs font-semibold text-indigo-700"
            >
              <input
                v-model="isComparingPreviousPeriod"
                class="size-3.5 accent-indigo-600"
                type="checkbox"
              />
              Сравнить
            </label>
            <select
              v-model="orderListPeriod"
              class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              aria-label="Фильтр заказов по дате или периоду"
            >
              <option value="day">День</option>
              <option value="week">Неделя</option>
              <option value="decade">Декада</option>
              <option value="month">Месяц</option>
              <option value="last30">Последние 30 дней</option>
              <option value="custom">Произвольный период</option>
            </select>
            <template v-if="orderListPeriod === 'day'">
              <div
                class="flex items-center overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
                aria-label="Фильтр заказов по одному дню"
              >
                <button
                  class="grid size-9 place-items-center text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                  type="button"
                  aria-label="На один день назад"
                  title="На один день назад"
                  @click="shiftOrderListDate(-1)"
                >
                  <ChevronLeft class="size-4" aria-hidden="true" />
                </button>
                <input
                  v-model="orderListDate"
                  class="h-9 w-36 border-x border-slate-200 bg-white px-2 text-center text-sm font-semibold tabular-nums text-slate-700 outline-none"
                  type="date"
                  aria-label="Дата заказов"
                />
                <button
                  class="grid size-9 place-items-center text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                  type="button"
                  aria-label="На один день вперёд"
                  title="На один день вперёд"
                  @click="shiftOrderListDate(1)"
                >
                  <ChevronRight class="size-4" aria-hidden="true" />
                </button>
              </div>
              <button
                class="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
                type="button"
                @click="showTodayInOrderList"
              >
                Сегодня
              </button>
            </template>
            <template v-if="orderListPeriod === 'custom'">
              <input
                v-model="orderListFrom"
                class="w-32 rounded-xl border border-slate-200 px-2 py-2 text-sm"
                type="date"
                aria-label="Начало периода заказов"
              />
              <span class="text-sm text-slate-400">—</span>
              <input
                v-model="orderListTo"
                class="w-32 rounded-xl border border-slate-200 px-2 py-2 text-sm"
                type="date"
                aria-label="Конец периода заказов"
              />
            </template>
          </div>
        </div>
        <div
          class="mt-3 hidden grid-cols-[9rem_6.25rem_minmax(13.5rem,2fr)_5rem_5rem_5.5rem_minmax(9.5rem,1fr)_3.5rem] gap-x-2 gap-y-3 px-5 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 lg:grid"
        >
          <span>Номер заказа</span><span>Статус<br />Площадка</span><span>Товары</span
          ><span class="border-l border-slate-200 pl-3 text-right">Сумма заказа</span
          ><span class="border-l border-slate-200 pl-3 text-right">Факт. прибыль</span
          ><span class="border-l border-slate-200 pl-3 text-right">План. прибыль</span
          ><span class="border-l border-slate-200 pl-3">Состояние отгрузки</span
          ><button
            class="flex items-center justify-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold normal-case tracking-normal transition"
            :class="
              isShowingUnpaidOnly
                ? 'border-rose-400 bg-rose-100 text-rose-700'
                : 'border-slate-300 bg-white text-slate-600 hover:border-rose-300 hover:text-rose-700'
            "
            type="button"
            @click="toggleUnpaidOrders"
          >
            Неоплаченные <span class="tabular-nums">{{ unpaidOrdersCount }}</span>
          </button>
        </div>
        <article
          v-for="order in visibleOrders"
          :key="order.id"
          :id="`order-${order.id}`"
          :data-order-id="String(order.id)"
          class="mb-3 overflow-hidden rounded-xl border bg-white shadow-sm transition"
          :class="
            isOrderExpanded(order)
              ? 'border-emerald-600 ring-2 ring-emerald-200 shadow-emerald-100'
              : 'border-slate-300 hover:border-slate-400'
          "
        >
          <div
            class="grid w-full gap-x-2 gap-y-3 px-5 py-4 text-left transition lg:grid-cols-[9rem_6.25rem_minmax(13.5rem,2fr)_5rem_5rem_5.5rem_minmax(9.5rem,1fr)_3.5rem] lg:items-center"
            :class="
              isOrderExpanded(order) ? 'bg-slate-200/80 hover:bg-slate-200' : 'hover:bg-slate-50'
            "
            role="button"
            tabindex="0"
            @click="toggleOrder(order.id)"
            @keydown.enter="toggleOrder(order.id)"
            @keydown.space.prevent="toggleOrder(order.id)"
          >
            <span
              ><span class="inline-flex items-center gap-1.5 whitespace-nowrap"
                ><button
                  v-if="order.platform === 'Эпицентр' && order.externalId"
                  class="rounded-md bg-indigo-100 p-1 text-indigo-700 ring-1 ring-indigo-200 transition hover:bg-indigo-200 hover:text-indigo-900"
                  type="button"
                  aria-label="Открыть заказ в Эпицентре"
                  @click.stop="openEpicentrOrder(order)"
                >
                  <ExternalLink class="size-5" aria-hidden="true" /></button
                ><button
                  v-if="order.platform === 'Пром' && order.externalId"
                  class="rounded-md bg-indigo-100 p-1 text-indigo-700 ring-1 ring-indigo-200 transition hover:bg-indigo-200 hover:text-indigo-900"
                  type="button"
                  aria-label="Открыть заказ в Prom"
                  @click.stop="openPromOrder(order)"
                >
                  <ExternalLink class="size-5" aria-hidden="true" /></button
                ><button
                  v-if="order.platform === 'Каста' && order.externalId"
                  class="rounded-md bg-indigo-100 p-1 text-indigo-700 ring-1 ring-indigo-200 transition hover:bg-indigo-200 hover:text-indigo-900"
                  type="button"
                  aria-label="Открыть заказ в Каста"
                  @click.stop="openKastaOrder(order)"
                >
                  <ExternalLink class="size-5" aria-hidden="true" /></button
                ><strong>{{ order.displayNumber ?? order.id }}</strong
                ><span
                  class="relative inline-flex items-center gap-1 align-middle text-sm font-semibold text-slate-400"
                  ><button
                    class="rounded p-1 text-violet-600 hover:bg-violet-100 hover:text-violet-800"
                    type="button"
                    aria-label="Скопировать номер"
                    @click.stop="copyOrderNumber(order)"
                  >
                    <Copy class="size-4" aria-hidden="true" /></button
                  ><span
                    v-if="inlineActionNotice?.key === `copy-order:${order.id}`"
                    class="pointer-events-none absolute top-full left-1/2 z-50 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs font-semibold text-white shadow-lg"
                    >Скопировано</span
                  ></span
                ></span
              ><span class="mt-1 block text-xs text-slate-500"
                >{{ order.date }}<template v-if="order.time"> · {{ order.time }}</template></span
              ><span
                v-if="isOrderUnprinted(order)"
                class="mt-1 inline-flex rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-900"
                >Не распечатан</span
              ></span
            ><span class="flex min-w-0 flex-col items-start gap-1"
              ><span
                class="block w-fit rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700"
                >{{ displayOrderStatus(order.status) }}</span
              ><strong :class="platformClass(orderBusinessPlatform(order))"
                ><PlatformLogo :platform="orderBusinessPlatform(order)" /></strong></span
            ><span class="flex min-w-0 items-center gap-3"
              ><img
                v-if="getOrderPreviewImage(order)"
                :src="getOrderPreviewImage(order)"
                :alt="order.products[0]?.name ?? 'Товар'"
                class="size-10 shrink-0 rounded-lg border border-slate-200 bg-white object-contain"
              /><span class="min-w-0"
                ><span class="block truncate text-sm">{{
                  order.products.map((product) => `${product.name} ×${product.quantity}`).join(', ')
                }}</span
                ><span
                  class="mt-1 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600"
                  >Позиций: {{ order.products.length }}</span
                ><span
                  v-if="orderHeaderPaymentLabel(order)"
                  class="ml-2 mt-1 inline-flex items-center rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-700"
                  >{{ orderHeaderPaymentLabel(order) }}</span
                ><span
                  v-if="promPaymentState(order) === 'paid'"
                  class="ml-2 mt-1 inline-flex items-center gap-1.5 rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-700"
                  ><span
                    class="grid size-4 place-items-center rounded-full bg-emerald-500 text-[10px] font-bold text-white"
                    >О</span
                  >Оплачено</span
                ><span
                  v-else-if="promPaymentState(order) === 'error'"
                  class="ml-2 mt-1 inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-600"
                  ><span class="text-sm font-bold text-emerald-500">О</span>Помилка оплати</span
                ><span
                  v-if="order.delivery.hasWebsiteCommission"
                  class="ml-2 mt-1 inline-flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-1 text-xs font-medium text-slate-900"
                  ><Globe2 class="size-4" aria-hidden="true" /> Замовлення з сайту</span
                ></span
              ></span
            ><strong
              class="flex self-stretch items-center justify-end whitespace-nowrap border-l border-slate-200 pl-3 text-right tabular-nums"
              >{{ formatMoney(getOrderAmount(order)) }}</strong
            ><span
              v-if="hasActualFinancialResult(order)"
              class="flex self-stretch flex-col items-end justify-center border-l border-slate-200 pl-3 text-right tabular-nums"
              ><strong class="whitespace-nowrap">{{ formatMoney(getActualProfit(order)) }}</strong>
              <span class="mt-0.5 block whitespace-nowrap text-xs text-slate-500"
                >({{ formatProfitPercent(getActualProfit(order), getOrderAmount(order)) }})</span
              ></span
            ><strong
              v-else
              class="flex self-stretch items-center justify-end border-l border-slate-200 pl-3 text-right tabular-nums"
              >—</strong
            ><span
              class="flex self-stretch flex-col items-end justify-center border-l border-slate-200 pl-3 text-right tabular-nums"
              ><strong class="whitespace-nowrap">{{ formatMoney(getPlannedProfit(order)) }}</strong>
              <span class="mt-0.5 block whitespace-nowrap text-xs text-slate-500"
                >({{ formatProfitPercent(getPlannedProfit(order), getOrderAmount(order)) }})</span
              ></span
            ><span
              class="flex w-fit flex-col items-start gap-1.5 lg:w-full lg:self-stretch lg:justify-center lg:border-l lg:border-slate-200 lg:pl-3"
              ><span
                v-if="isUnopenedNewOrder(order)"
                class="whitespace-nowrap rounded-lg bg-fuchsia-600 px-3 py-1.5 text-[11px] font-black tracking-wide text-white shadow-md ring-2 ring-fuchsia-200"
                >НОВЫЙ ЗАКАЗ</span
              ><span
                class="w-fit rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 lg:w-full lg:line-clamp-2 lg:leading-5"
                >{{ deliveryStatusForOrder(order) }}</span
              ></span
            ><span class="flex items-center justify-end gap-2"
              ><CarrierLogo
                v-if="carrierLogoKind(order) !== 'generic'"
                :kind="carrierLogoKind(order)"
                :title="displayCarrier(order.delivery.carrier)" />
              <button
                v-if="!isGuest"
                class="grid size-7 place-items-center rounded-md border border-rose-200 bg-white text-sm font-bold text-rose-600 hover:bg-rose-50"
                type="button"
                aria-label="Удалить заказ из CRM"
                @click.stop="deleteOrder(order)"
              >
                <RefreshCw
                  v-if="deletingOrderId === order.id"
                  class="size-4 animate-spin"
                  aria-hidden="true"
                /><Trash2 v-else class="size-4" aria-hidden="true" /></button
            ></span>
          </div>
          <div
            v-if="isOrderExpanded(order)"
            class="grid gap-5 bg-slate-200/80 p-5 lg:grid-cols-[minmax(0,1fr)_21rem]"
            @click="handleOrderWorkspaceClick(order, $event)"
          >
            <section :class="{ 'pointer-events-none select-none opacity-75': isGuest }">
              <div class="flex flex-wrap items-center gap-3">
                <span v-if="!isGuest" class="relative inline-flex items-center">
                  <button
                    class="rounded-lg border px-3 py-1.5 text-sm font-semibold"
                    :class="
                      isSpreadsheetOrderCopied(order)
                        ? 'border-slate-300 bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-600'
                        : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-900'
                    "
                    type="button"
                    title="Скопировать строку для Excel"
                    aria-label="Скопировать строку для Excel"
                    @click="copyOrderForSpreadsheet(order)"
                  >
                    Excel
                  </button>
                  <span
                    v-if="inlineActionNotice?.key === `copy-excel:${order.id}`"
                    class="pointer-events-none absolute top-full left-1/2 z-50 mt-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white shadow-lg"
                    >Строка скопирована</span
                  >
                </span>
                <div class="ml-auto flex flex-wrap items-center justify-end gap-3">
                  <span
                    v-if="returnSignalLabel(order) && !isOrderFullyReturned(order)"
                    class="rounded-lg bg-rose-100 px-3 py-1.5 text-sm font-bold text-rose-800"
                  >
                    {{ returnSignalLabel(order) }} · возврат ожидает принятия
                  </span>
                  <button
                    v-if="!isGuest && order.delivery.printedAt"
                    :disabled="isSavingReturn"
                    class="rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
                    :class="
                      returnSignalLabel(order)
                        ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                    "
                    type="button"
                    @click="openReturnEditor(order)"
                  >
                    {{
                      isOrderFullyReturned(order) ? 'Изменить принятый возврат' : 'Принять возврат'
                    }}
                  </button>
                  <button
                    v-if="!isGuest && !order.externalId"
                    class="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    type="button"
                    @click="openEditOrderDialog(order)"
                  >
                    Редактировать заказ
                  </button>
                  <button
                    v-if="order.platform === 'Эпицентр' && order.externalId"
                    class="relative rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-wait disabled:opacity-60"
                    type="button"
                    :disabled="isSyncingEpicentr"
                    @click="syncEpicentrOrder(order)"
                  >
                    <RefreshCw
                      class="mr-1 inline size-4"
                      :class="{ 'animate-spin': isSyncingEpicentr }"
                      aria-hidden="true"
                    />
                    {{ isSyncingEpicentr ? 'Синхронизация…' : 'Синхронизировать заказ' }}
                    <span
                      v-if="inlineActionNotice?.key === `sync:${order.id}`"
                      class="pointer-events-none absolute top-full left-1/2 z-50 mt-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white shadow-lg"
                      >Синхронизировано</span
                    >
                  </button>
                  <button
                    v-if="order.platform === 'Пром' && order.externalId"
                    class="relative rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-wait disabled:opacity-60"
                    type="button"
                    :disabled="isSyncingProm"
                    @click="syncPromOrder(order)"
                  >
                    <RefreshCw
                      class="mr-1 inline size-4"
                      :class="{ 'animate-spin': isSyncingProm }"
                      aria-hidden="true"
                    />
                    {{ isSyncingProm ? 'Синхронизация…' : 'Синхронизировать заказ' }}
                    <span
                      v-if="inlineActionNotice?.key === `sync:${order.id}`"
                      class="pointer-events-none absolute top-full left-1/2 z-50 mt-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white shadow-lg"
                      >Синхронизировано</span
                    >
                  </button>
                  <button
                    v-if="order.platform === 'Каста' && order.externalId"
                    class="relative rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-wait disabled:opacity-60"
                    type="button"
                    :disabled="isSyncingKasta"
                    @click="syncKastaOrder(order)"
                  >
                    <RefreshCw
                      class="mr-1 inline size-4"
                      :class="{ 'animate-spin': isSyncingKasta }"
                      aria-hidden="true"
                    />
                    {{ isSyncingKasta ? 'Синхронизация…' : 'Синхронизировать заказ' }}
                    <span
                      v-if="inlineActionNotice?.key === `sync:${order.id}`"
                      class="pointer-events-none absolute top-full left-1/2 z-50 mt-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white shadow-lg"
                      >Синхронизировано</span
                    >
                  </button>
                  <label class="flex items-center gap-2 text-sm text-slate-500"
                    >Статус<select
                      :value="displayOrderStatus(order.status)"
                      class="rounded-lg border border-emerald-200 bg-white px-2 py-1 font-semibold text-emerald-800"
                      @change="updateOrderStatus(order, ($event.target as HTMLSelectElement).value)"
                    >
                      <option
                        v-for="status in statusOptionsForOrder(order)"
                        :key="status"
                        :value="status"
                      >
                        {{ status }}
                      </option>
                    </select></label
                  >
                </div>
              </div>
              <section
                v-if="isReturnEditorOpen(order)"
                data-order-card
                class="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4"
              >
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 class="font-semibold text-rose-950">Принять возврат</h4>
                    <p class="mt-1 text-sm text-rose-800">
                      Финансовый возврат будет учтён только после сохранения.
                    </p>
                  </div>
                  <button
                    :disabled="isSavingReturn"
                    class="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-sm font-semibold text-rose-700 disabled:opacity-50"
                    type="button"
                    @click="acceptWholeReturnDraft(order)"
                  >
                    Принять весь возврат
                  </button>
                </div>
                <div class="mt-3 grid gap-2">
                  <label
                    v-for="product in order.products"
                    :key="product.id"
                    class="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-sm"
                  >
                    <span class="min-w-0 font-medium">{{ product.name }}</span>
                    <span class="flex items-center gap-2"
                      >Количество возвращено<input
                        v-model="returnDraftQuantities[productReturnKey(order, product)]"
                        :disabled="isSavingReturn"
                        class="w-20 rounded border border-rose-200 px-2 py-1 text-right"
                        inputmode="numeric"
                        type="number"
                        min="0"
                        :max="product.quantity"
                        @keydown.enter.prevent
                      /><span class="text-slate-500">из {{ product.quantity }}</span></span
                    >
                  </label>
                </div>
                <div class="mt-3 flex flex-wrap items-end justify-between gap-3">
                  <label class="text-sm font-medium text-slate-600"
                    >Дата принятия<input
                      v-model="returnDraftDate"
                      :disabled="isSavingReturn"
                      class="mt-1 block rounded border border-rose-200 bg-white px-2 py-1"
                      type="date"
                    />
                  </label>
                  <button
                    :disabled="isSavingReturn"
                    class="rounded-lg bg-rose-700 px-4 py-2 font-semibold text-white disabled:opacity-50"
                    type="button"
                    @click="saveAcceptedReturns(order)"
                  >
                    {{ isSavingReturn ? 'Сохраняем…' : 'Подтвердить принятие возврата' }}
                  </button>
                </div>
              </section>
              <section
                data-order-card
                class="mt-4 rounded-xl border border-slate-300 bg-white px-4 py-3"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
                    <h4 class="mr-2 font-semibold">Данные покупателя</h4>
                    <span
                      ><span class="text-slate-500">Покупатель: </span
                      ><strong>{{ order.customer }}</strong></span
                    >
                    <span
                      ><span class="text-slate-500">Телефон: </span
                      ><strong>{{
                        formatUkrainianPhone(order.phone || order.delivery.recipientPhone) || '—'
                      }}</strong></span
                    >
                    <span v-if="order.customerEmail"
                      ><span class="text-slate-500">Email: </span
                      ><strong class="break-all">{{ order.customerEmail }}</strong></span
                    >
                    <span
                      v-if="order.customerComment"
                      class="basis-full border-t border-slate-100 pt-2"
                      ><span class="text-slate-500">Комментарий покупателя: </span
                      ><strong class="whitespace-pre-wrap">{{
                        order.customerComment
                      }}</strong></span
                    >
                  </div>
                  <button
                    type="button"
                    class="grid size-8 shrink-0 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
                    :class="{ 'bg-blue-100 text-blue-700': isInternalCommentVisible(order) }"
                    :disabled="isGuest"
                    title="Комментарий к заказу"
                    aria-label="Комментарий к заказу"
                    @click="toggleInternalComment(order)"
                  >
                    <MessageSquare class="size-4" aria-hidden="true" />
                  </button>
                </div>
              </section>
              <div
                data-order-card
                class="mt-4 overflow-visible rounded-xl border border-slate-300 bg-white"
              >
                <div
                  v-for="product in order.products"
                  :key="product.id"
                  class="order-edit flex gap-3 border-b-2 border-slate-300 p-4 last:border-b-0"
                >
                  <div v-if="product.imageUrl" class="group relative z-20 shrink-0">
                    <img
                      :src="product.imageUrl"
                      :alt="product.name"
                      class="size-14 rounded-lg border border-slate-200 bg-white object-contain"
                    />
                    <div
                      class="pointer-events-none absolute bottom-0 left-0 z-30 size-64 rounded-xl border-2 border-indigo-200 bg-white p-1 opacity-0 shadow-2xl transition duration-150 group-hover:opacity-100"
                    >
                      <img
                        :src="product.imageUrl"
                        :alt="product.name"
                        class="size-full max-w-none rounded-lg object-contain"
                      />
                    </div>
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="min-w-0">
                      <strong class="block">{{ product.name }}</strong>
                      <div
                        class="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-[2.5rem_5.75rem_2.75rem_3.4rem_3.6rem_3.2rem_3.8rem_8.25rem] sm:justify-end"
                      >
                        <div class="mt-5 flex h-8 items-center justify-center">
                          <button
                            v-if="canLinkProductPrice(order, product)"
                            class="grid size-8 place-items-center rounded-lg border transition"
                            :class="
                              isProductPriceLinked(order, product)
                                ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                : 'border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100'
                            "
                            :disabled="isGuest"
                            :title="
                              isProductPriceLinked(order, product)
                                ? 'Товар привязан к себестоимости. Нажмите, чтобы изменить привязку.'
                                : 'Привязать товар к строке себестоимости'
                            "
                            type="button"
                            @click="openProductPriceLink(order, product)"
                          >
                            <Link2 class="size-4" aria-hidden="true" />
                            <span class="sr-only">Привязать себестоимость</span>
                          </button>
                        </div>
                        <p
                          class="mt-5 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-2 text-sm font-semibold text-violet-700"
                          :class="{ invisible: !product.size }"
                        >
                          <span class="text-xs uppercase tracking-wide">Размер</span>
                          <strong class="text-base leading-none text-violet-950">{{
                            product.size
                          }}</strong>
                        </p>
                        <label class="text-xs font-medium text-slate-500"
                          >Кол.<input
                            :value="
                              orderCellValue(`${order.id}-${product.id}-quantity`, product.quantity)
                            "
                            :readonly="editingOrderCell !== `${order.id}-${product.id}-quantity`"
                            class="order-cell-edit mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-semibold text-slate-900"
                            type="text"
                            @input="
                              updateOrderNumber(
                                product,
                                'quantity',
                                `${order.id}-${product.id}-quantity`,
                                $event,
                              )
                            "
                            @blur="finishOrderCell(`${order.id}-${product.id}-quantity`)"
                            @keydown.enter.prevent="
                              toggleOrderCell(`${order.id}-${product.id}-quantity`, $event)
                            "
                        /></label>
                        <label class="text-xs font-medium text-slate-500"
                          >Цена, ₴<input
                            :value="
                              orderCellValue(`${order.id}-${product.id}-price`, product.price)
                            "
                            :readonly="editingOrderCell !== `${order.id}-${product.id}-price`"
                            class="order-cell-edit mt-1 w-full rounded-lg border border-blue-100 px-2 py-1.5 text-sm font-semibold text-slate-900"
                            type="text"
                            @input="
                              updateOrderNumber(
                                product,
                                'price',
                                `${order.id}-${product.id}-price`,
                                $event,
                              )
                            "
                            @blur="finishOrderCell(`${order.id}-${product.id}-price`)"
                            @keydown.enter.prevent="
                              toggleOrderCell(`${order.id}-${product.id}-price`, $event)
                            "
                        /></label>
                        <div class="text-xs font-medium text-slate-500">
                          Итого<strong
                            class="mt-1 block rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-900"
                            >{{ formatNumber(getProductAmount(product)) }}</strong
                          >
                        </div>
                        <label class="text-xs font-medium text-slate-500"
                          ><span
                            class="inline-flex whitespace-nowrap rounded-full bg-emerald-100 px-2 py-0.5 font-bold text-emerald-800"
                            >С/С $</span
                          ><input
                            :value="
                              orderCellValue(
                                `${order.id}-${product.id}-cost-usd`,
                                product.costUsd ?? 0,
                              )
                            "
                            :readonly="editingOrderCell !== `${order.id}-${product.id}-cost-usd`"
                            class="order-cell-edit mt-1 w-full rounded-lg border border-emerald-100 px-2 py-1.5 text-sm font-semibold text-slate-900"
                            inputmode="decimal"
                            type="text"
                            @input="
                              updateOrderNumber(
                                product,
                                'costUsd',
                                `${order.id}-${product.id}-cost-usd`,
                                $event,
                              )
                            "
                            @blur="finishOrderCell(`${order.id}-${product.id}-cost-usd`)"
                            @keydown.enter.prevent="
                              toggleOrderCell(`${order.id}-${product.id}-cost-usd`, $event)
                            "
                        /></label>
                        <label class="text-xs font-medium text-slate-500"
                          ><span
                            class="inline-flex whitespace-nowrap rounded-full bg-[#f7e2df] px-2 py-0.5 font-bold text-[#8d4d58]"
                            >С/С ₴</span
                          ><input
                            :value="orderCellValue(`${order.id}-${product.id}-cost`, product.cost)"
                            :readonly="editingOrderCell !== `${order.id}-${product.id}-cost`"
                            class="order-cell-edit mt-1 w-full rounded-lg border border-emerald-100 px-2 py-1.5 text-sm font-semibold text-slate-900"
                            :class="{
                              'border-orange-500 bg-orange-200 ring-1 ring-orange-300':
                                product.cost === 0 && (product.costUsd ?? 0) === 0,
                            }"
                            type="text"
                            @input="
                              updateOrderNumber(
                                product,
                                'cost',
                                `${order.id}-${product.id}-cost`,
                                $event,
                              )
                            "
                            @blur="finishOrderCell(`${order.id}-${product.id}-cost`)"
                            @keydown.enter.prevent="
                              toggleOrderCell(`${order.id}-${product.id}-cost`, $event)
                            "
                        /></label>
                        <div class="grid grid-cols-2 gap-1.5">
                          <label class="text-xs font-medium text-slate-500"
                            ><span class="whitespace-nowrap">Роялти, %</span
                            ><input
                              :value="
                                orderCellValue(
                                  `${order.id}-${product.id}-royalty-percent`,
                                  product.royaltyPercent ?? (order.platform === 'Каста' ? 22 : 0),
                                )
                              "
                              :readonly="
                                editingOrderCell !== `${order.id}-${product.id}-royalty-percent`
                              "
                              class="order-cell-edit mt-1 w-full rounded-lg border border-orange-100 px-2 py-1.5 text-sm font-semibold text-slate-900"
                              :class="{
                                'border-orange-500 bg-orange-200 ring-1 ring-orange-300':
                                  order.platform === 'Эпицентр' &&
                                  product.royaltyPercent === undefined,
                              }"
                              inputmode="decimal"
                              type="text"
                              @input="
                                updateProductRoyaltyPercent(
                                  product,
                                  `${order.id}-${product.id}-royalty-percent`,
                                  $event,
                                )
                              "
                              @blur="
                                finishOrderCell(`${order.id}-${product.id}-royalty-percent`, () =>
                                  syncProductRoyaltyAmount(order, product),
                                )
                              "
                              @keydown.enter.prevent="
                                toggleOrderCell(
                                  `${order.id}-${product.id}-royalty-percent`,
                                  $event,
                                  () => syncProductRoyaltyAmount(order, product),
                                )
                              " /></label
                          ><label class="text-xs font-medium text-slate-500"
                            ><span class="whitespace-nowrap">Роялти, ₴</span
                            ><input
                              :value="
                                orderCellValue(
                                  `${order.id}-${product.id}-royalty-amount`,
                                  getProductRoyalty(order, product),
                                )
                              "
                              :readonly="
                                editingOrderCell !== `${order.id}-${product.id}-royalty-amount`
                              "
                              class="order-cell-edit mt-1 w-full rounded-lg border border-orange-100 px-2 py-1.5 text-sm font-semibold text-slate-900"
                              inputmode="decimal"
                              type="text"
                              @input="
                                updateProductRoyaltyAmount(
                                  product,
                                  `${order.id}-${product.id}-royalty-amount`,
                                  $event,
                                )
                              "
                              @blur="
                                finishOrderCell(`${order.id}-${product.id}-royalty-amount`, () =>
                                  syncProductRoyaltyPercent(order, product),
                                )
                              "
                              @keydown.enter.prevent="
                                toggleOrderCell(
                                  `${order.id}-${product.id}-royalty-amount`,
                                  $event,
                                  () => syncProductRoyaltyPercent(order, product),
                                )
                              "
                          /></label>
                        </div>
                      </div>
                      <div class="mt-3 flex flex-wrap items-center gap-2 text-sm">
                        <span
                          v-if="(product.returnedQuantity ?? 0) > 0"
                          class="font-semibold text-rose-700"
                        >
                          Возврат {{ product.returnedQuantity }}/{{ product.quantity }}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div
                data-order-card
                class="order-edit mt-4 grid grid-cols-2 gap-3 rounded-xl border border-slate-300 bg-white p-4 text-sm sm:grid-cols-3 lg:grid-cols-[1fr_1fr_1fr_5rem_6rem_6.5rem_6.5rem]"
              >
                <div>
                  <span class="text-slate-500">Итого с/с</span
                  ><strong class="mt-1 block text-base">{{
                    formatMoney(getNetOrderCost(order))
                  }}</strong>
                </div>
                <div>
                  <span class="text-slate-500">Итого продажа</span
                  ><strong class="mt-1 block text-base">{{
                    formatMoney(getNetOrderAmount(order))
                  }}</strong>
                </div>
                <div>
                  <span class="text-slate-500">Роялти</span
                  ><strong class="mt-1 block text-base">{{
                    formatMoney(getNetRoyalty(order))
                  }}</strong>
                </div>
                <label class="text-slate-500"
                  >Доставка<input
                    :value="orderCellValue(`${order.id}-shipping`, order.shipping)"
                    :readonly="editingOrderCell !== `${order.id}-shipping`"
                    class="order-cell-edit mt-1 block w-full rounded-lg border border-slate-200 px-2 py-1 text-sm font-semibold text-slate-900"
                    inputmode="decimal"
                    type="text"
                    @input="updateOrderFinancial(order, 'shipping', `${order.id}-shipping`, $event)"
                    @blur="finishOrderCell(`${order.id}-shipping`)"
                    @keydown.enter.prevent="toggleOrderCell(`${order.id}-shipping`, $event)"
                /></label>
                <label class="text-slate-500"
                  >Сумма оплаты<input
                    :value="orderCellValue(`${order.id}-payment-amount`, order.paymentAmount ?? 0)"
                    :readonly="editingOrderCell !== `${order.id}-payment-amount`"
                    class="order-cell-edit mt-1 block w-full rounded-lg border px-2 py-1 text-sm font-semibold"
                    :class="promRegistryFieldClass(order, 'paymentAmount')"
                    inputmode="decimal"
                    type="text"
                    @input="
                      updateOrderFinancial(
                        order,
                        'paymentAmount',
                        `${order.id}-payment-amount`,
                        $event,
                      )
                    "
                    @blur="finishOrderCell(`${order.id}-payment-amount`)"
                    @keydown.enter.prevent="toggleOrderCell(`${order.id}-payment-amount`, $event)"
                /></label>
                <div>
                  <span class="text-slate-500">Экв.</span>
                  <label class="mt-1 flex items-center gap-1 text-slate-500"
                    ><input
                      :value="
                        financialOrderCellValue(
                          `${order.id}-acquiring-percent`,
                          order.acquiringPercent,
                        )
                      "
                      :readonly="editingOrderCell !== `${order.id}-acquiring-percent`"
                      class="order-cell-edit block w-20 rounded-lg border px-2 py-1 text-sm font-semibold"
                      :class="promRegistryFieldClass(order, 'acquiring')"
                      inputmode="decimal"
                      type="text"
                      @input="
                        updateOrderFinancial(
                          order,
                          'acquiringPercent',
                          `${order.id}-acquiring-percent`,
                          $event,
                        )
                      "
                      @blur="
                        finishOrderCell(`${order.id}-acquiring-percent`, () =>
                          syncAcquiringAmount(order),
                        )
                      "
                      @keydown.enter.prevent="
                        toggleOrderCell(`${order.id}-acquiring-percent`, $event, () =>
                          syncAcquiringAmount(order),
                        )
                      "
                    /><span>%</span></label
                  ><label class="mt-1 flex items-center gap-1 text-slate-500"
                    ><input
                      :value="financialOrderCellValue(`${order.id}-acquiring`, order.acquiring)"
                      :readonly="editingOrderCell !== `${order.id}-acquiring`"
                      class="order-cell-edit block w-20 rounded-lg border px-2 py-1 text-sm font-semibold"
                      :class="promRegistryFieldClass(order, 'acquiring')"
                      inputmode="decimal"
                      type="text"
                      @input="
                        updateOrderFinancial(order, 'acquiring', `${order.id}-acquiring`, $event)
                      "
                      @blur="
                        finishOrderCell(`${order.id}-acquiring`, () => syncAcquiringPercent(order))
                      "
                      @keydown.enter.prevent="
                        toggleOrderCell(`${order.id}-acquiring`, $event, () =>
                          syncAcquiringPercent(order),
                        )
                      "
                    /><span>₴</span></label
                  >
                </div>
                <label class="text-slate-500"
                  >Прочее<input
                    :value="
                      financialOrderCellValue(`${order.id}-extra-expenses`, order.extraExpenses)
                    "
                    :readonly="editingOrderCell !== `${order.id}-extra-expenses`"
                    class="order-cell-edit mt-1 inline-block w-20 rounded-lg border border-slate-200 px-2 py-1 text-sm font-semibold text-slate-900"
                    inputmode="decimal"
                    type="text"
                    @input="
                      updateOrderFinancial(
                        order,
                        'extraExpenses',
                        `${order.id}-extra-expenses`,
                        $event,
                      )
                    "
                    @blur="finishOrderCell(`${order.id}-extra-expenses`)"
                    @keydown.enter.prevent="toggleOrderCell(`${order.id}-extra-expenses`, $event)"
                  /><span class="ml-1">₴</span></label
                >
              </div>
              <label
                v-if="isInternalCommentVisible(order)"
                data-order-card
                class="order-edit mt-4 block rounded-xl border border-slate-300 bg-white p-4 text-sm text-slate-500"
                >Комментарий к заказу<textarea
                  :value="internalCommentValue(order)"
                  :rows="internalCommentRows(order)"
                  :readonly="isGuest || editingInternalCommentOrderId !== order.id"
                  class="order-cell-edit mt-2 block min-h-0 w-full resize-none rounded-lg border px-3 py-2 text-sm leading-6 text-slate-900 outline-none transition"
                  :class="
                    editingInternalCommentOrderId === order.id
                      ? 'border-amber-300 bg-amber-50 ring-2 ring-amber-100'
                      : 'border-slate-200 bg-slate-50'
                  "
                  placeholder="Введите внутренний комментарий"
                  @input="updateInternalCommentDraft(order, $event)"
                  @keydown.enter.prevent="toggleInternalCommentEdit(order)"
                />
              </label>
            </section>
            <aside
              data-order-card
              class="rounded-xl border-2 border-slate-400 bg-white p-5 shadow-md ring-1 ring-slate-300"
            >
              <div class="flex items-start justify-between gap-3">
                <h3 class="text-lg font-semibold">Доставка</h3>
                <span
                  class="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700"
                  >{{ deliveryStatusForOrder(order) }}</span
                >
              </div>
              <dl class="mt-2 text-sm">
                <div class="pb-1">
                  <div class="space-y-0.5 text-center">
                    <dd
                      class="relative flex min-w-0 items-center justify-center gap-2 font-semibold"
                    >
                      <button
                        v-if="oneCClipboardText(order.delivery)"
                        class="absolute left-0 top-1/2 h-5 min-w-7 -translate-y-1/2 rounded border border-slate-300 bg-slate-100 px-1.5 text-[10px] font-bold text-slate-600 hover:bg-slate-200 hover:text-slate-800"
                        type="button"
                        title="Скопировать строку для 1С"
                        aria-label="Скопировать строку для 1С"
                        @click="copyOneCTemplate(order.delivery, order.id)"
                      >
                        1с
                        <span
                          v-if="inlineActionNotice?.key === `copy-1c:${order.id}`"
                          class="pointer-events-none absolute top-full left-0 z-50 mt-1 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs font-semibold text-white shadow-lg"
                          >Скопировано</span
                        >
                      </button>
                      <CarrierLogo
                        v-if="carrierLogoKind(order) !== 'generic'"
                        :kind="carrierLogoKind(order)"
                      />
                      <Truck v-else class="size-5 shrink-0 text-slate-500" aria-hidden="true" />
                      <span class="min-w-0">{{ displayCarrier(order.delivery.carrier) }}</span>
                    </dd>
                    <dd
                      class="flex min-w-0 items-center justify-center gap-1 font-semibold text-blue-700"
                    >
                      <span class="text-[10px] font-semibold tracking-wide text-slate-500 uppercase"
                        >Текущая ТТН:</span
                      >
                      <a
                        v-if="trackingUrl(order.delivery)"
                        :href="trackingUrl(order.delivery)"
                        class="grid size-6 shrink-0 place-items-center rounded text-blue-600 hover:bg-blue-100 hover:text-blue-800"
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Відкрити відстеження"
                        @click.stop
                      >
                        <ExternalLink class="size-4" aria-hidden="true" />
                      </a>
                      <span>{{
                        order.delivery.ttn
                          ? formatDeliveryTtn(order.delivery.carrier, order.delivery.ttn)
                          : '—'
                      }}</span>
                      <button
                        v-if="order.delivery.ttn"
                        class="relative grid size-6 shrink-0 place-items-center rounded text-violet-600 hover:bg-violet-100 hover:text-violet-800"
                        type="button"
                        aria-label="Скопировать номер ТТН"
                        @click="copyTtn(order.delivery, order.id)"
                      >
                        <Copy class="size-4" aria-hidden="true" />
                        <span
                          v-if="inlineActionNotice?.key === `copy-ttn:${order.id}`"
                          class="pointer-events-none absolute top-full right-0 z-50 mt-1 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs font-semibold text-white shadow-lg"
                          >Скопировано</span
                        >
                      </button>
                    </dd>
                    <dd
                      v-if="deliveryWasRedirected(order.delivery)"
                      class="text-xs font-semibold text-violet-700"
                    >
                      Переадресовано
                    </dd>
                  </div>
                </div>
                <div class="grid grid-cols-2 gap-x-4 gap-y-3">
                  <div class="min-w-0">
                    <dt class="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                      Получатель
                    </dt>
                    <dd class="mt-1 break-words font-semibold">{{ order.delivery.recipient }}</dd>
                  </div>
                  <dd class="self-end break-all font-semibold">
                    {{ formatUkrainianPhone(order.delivery.recipientPhone) }}
                  </dd>
                </div>
                <div class="mt-3">
                  <dt class="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                    {{ hasDeliveryHistory(order.delivery) ? 'Сейчас' : 'Адрес' }}
                  </dt>
                  <dd class="mt-1 break-words font-semibold">
                    {{ displayDeliveryAddress(order.delivery.city, order.delivery.address) }}
                  </dd>
                  <details
                    v-if="hasDeliveryHistory(order.delivery)"
                    class="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                  >
                    <summary class="cursor-pointer text-xs font-semibold text-slate-600">
                      Ранее
                    </summary>
                    <div class="mt-2 space-y-2 text-xs text-slate-600">
                      <div
                        v-for="(entry, historyIndex) in previousShipmentHistory(order.delivery)"
                        :key="`${shipmentHistoryIdentity(entry)}:${historyIndex}`"
                        class="border-t border-slate-200 pt-2 first:border-t-0 first:pt-0"
                      >
                        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span class="font-semibold text-slate-800">{{
                            formatDeliveryTtn(order.delivery.carrier, entry.ttn)
                          }}</span>
                          <span
                            class="text-[10px] font-semibold tracking-wide text-slate-500 uppercase"
                            >{{ shipmentRelationLabel(entry.relation) }}</span
                          >
                        </div>
                        <div class="mt-0.5 break-words">{{ shipmentHistoryAddress(entry) }}</div>
                      </div>
                      <div v-if="legacyPreviousTtns(order.delivery).length">
                        <span class="font-semibold text-slate-700">{{
                          legacyPreviousTtns(order.delivery).length === 1
                            ? 'Первоначальная ТТН:'
                            : 'Предыдущие ТТН:'
                        }}</span>
                        {{
                          legacyPreviousTtns(order.delivery)
                            .map((ttn) => formatDeliveryTtn(order.delivery.carrier, ttn))
                            .join(', ')
                        }}
                      </div>
                      <div v-if="legacyPreviousAddresses(order.delivery).length">
                        <span class="font-semibold text-slate-700">Предыдущие адреса:</span>
                        {{ legacyPreviousAddresses(order.delivery).join(' · ') }}
                      </div>
                    </div>
                  </details>
                </div>
                <div class="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                  <div class="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4">
                    <dt class="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                      Способ оплаты
                    </dt>
                    <dd
                      class="min-w-0 justify-self-end break-words text-right font-semibold"
                      :class="{
                        'text-emerald-600': isDeliveryPaymentPaid(order),
                        'text-rose-600': promPaymentState(order) === 'error',
                        'text-slate-950':
                          !isDeliveryPaymentPaid(order) && promPaymentState(order) !== 'error',
                        'rounded-lg border border-slate-200 bg-white px-3 py-1 shadow-sm':
                          isPromPaymentMethod(order.delivery.paymentMethod) ||
                          isDeliveryPaymentPaid(order),
                      }"
                    >
                      {{ displayPaymentMethod(order.delivery.paymentMethod) }}
                    </dd>
                  </div>
                  <div class="my-3 border-t border-slate-200"></div>
                  <div class="grid grid-cols-2 gap-4">
                    <div>
                      <dt class="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                        Оценочная стоимость
                      </dt>
                      <dd class="mt-1 whitespace-nowrap font-semibold">
                        {{ formatMoney(getOrderAmount(order)) }}
                      </dd>
                    </div>
                    <div class="text-right">
                      <dt class="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                        Доставка
                      </dt>
                      <dd class="mt-1 whitespace-nowrap font-semibold">
                        {{ formatMoney(order.shipping) }}
                      </dd>
                    </div>
                  </div>
                </div>
              </dl>
            </aside>
          </div>
        </article>
        <p v-if="visibleOrders.length === 0" class="p-8 text-center text-sm text-slate-500">
          Заказы не найдены.
        </p>
        <div class="mt-5">
          <RouterLink
            class="inline-flex rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-emerald-300 hover:text-emerald-800"
            to="/reconciliation"
          >
            Сверка расчётов
          </RouterLink>
        </div>
        <div
          v-if="isPromRegistryView"
          class="sticky bottom-4 z-10 ml-auto mt-5 flex w-fit max-w-full flex-wrap justify-end gap-3 rounded-2xl border border-violet-200 bg-violet-50/95 p-4 shadow-lg backdrop-blur"
        >
          <button
            v-if="isPromRegistryDraft"
            class="rounded-xl border border-violet-200 bg-white px-4 py-3 text-sm font-semibold text-violet-800 hover:bg-violet-100"
            type="button"
            @click="clearPromRegistry"
          >
            Отменить черновик
          </button>
          <button
            v-if="isPromRegistryDraft"
            class="rounded-xl bg-violet-700 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-wait disabled:opacity-60"
            :disabled="isApplyingPromRegistry || promRegistryOrders.length === 0"
            type="button"
            @click="confirmPromRegistryDistribution"
          >
            {{ isApplyingPromRegistry ? 'Сохраняем…' : 'Подтвердить разнесение реестра' }}
          </button>
        </div>
      </section>
    </div>

    <dialog
      ref="orderDialog"
      class="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-5xl overflow-hidden rounded-2xl border border-slate-200 p-0 shadow-2xl backdrop:bg-slate-950/35"
    >
      <form
        class="flex max-h-[calc(100dvh-2rem)] flex-col bg-slate-50"
        novalidate
        @submit.prevent="saveOrderDraft"
      >
        <div
          class="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 py-4"
        >
          <div>
            <h2 class="text-xl font-semibold text-slate-900">
              {{ editingManualOrderId === null ? 'Новый заказ' : 'Редактирование заказа' }}
            </h2>
            <p class="mt-1 text-sm text-slate-500">
              Обязательные поля отмечены *. ТТН и данные доставки можно заполнить позже.
            </p>
          </div>
          <button
            class="rounded-lg px-3 py-1 text-2xl leading-none text-slate-500 hover:bg-slate-100"
            type="button"
            aria-label="Закрыть"
            @click="orderDialog?.close()"
          >
            <X class="size-5" aria-hidden="true" />
          </button>
        </div>

        <div class="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
          <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 class="text-base font-semibold text-slate-900">Основные данные</h3>
            <div class="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <label class="text-sm font-medium text-slate-700">
                Покупатель *
                <input
                  v-model="orderDraft.customer"
                  class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900"
                  autocomplete="off"
                />
              </label>
              <label class="text-sm font-medium text-slate-700">
                Телефон покупателя *
                <input
                  v-model="orderDraft.phone"
                  class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900"
                  inputmode="tel"
                  autocomplete="off"
                />
              </label>
              <label class="text-sm font-medium text-slate-700">
                Площадка
                <select
                  v-model="orderDraft.platform"
                  class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900"
                  @change="updateDraftPlatform"
                >
                  <option v-for="platform in platformOptions" :key="platform" :value="platform">
                    {{ platform }}
                  </option>
                </select>
              </label>
              <label class="text-sm font-medium text-slate-700">
                Статус
                <select
                  v-model="orderDraft.status"
                  class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900"
                >
                  <option
                    v-for="status in statusOptions[orderDraft.platform]"
                    :key="status"
                    :value="status"
                  >
                    {{ status }}
                  </option>
                </select>
              </label>
              <label class="text-sm font-medium text-slate-700">
                Дата заказа *
                <input
                  v-model="orderDraft.date"
                  class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900"
                  type="date"
                />
              </label>
              <label class="text-sm font-medium text-slate-700">
                Время заказа
                <input
                  v-model="orderDraft.time"
                  class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900"
                  type="time"
                />
              </label>
            </div>
          </section>

          <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div class="flex items-center justify-between gap-4">
              <div>
                <h3 class="text-base font-semibold text-slate-900">Товары</h3>
                <p class="mt-1 text-xs text-slate-500">
                  Название обязательно. Размер можно оставить пустым.
                </p>
              </div>
              <button
                class="shrink-0 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
                type="button"
                @click="addProduct"
              >
                <Plus class="mr-1 inline size-4" aria-hidden="true" /> Добавить товар
              </button>
            </div>

            <div class="mt-4 space-y-4">
              <div
                v-for="(product, productIndex) in orderDraft.products"
                :key="product.id"
                class="rounded-xl border border-slate-200 bg-slate-50 p-4"
              >
                <div class="mb-3 flex items-center justify-between">
                  <span class="text-sm font-semibold text-slate-700"
                    >Товар {{ productIndex + 1 }}</span
                  >
                  <button
                    v-if="orderDraft.products.length > 1"
                    class="rounded-lg px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50"
                    type="button"
                    @click="removeProduct(product.id)"
                  >
                    <Trash2 class="mr-1 inline size-4" aria-hidden="true" /> Удалить товар
                  </button>
                </div>
                <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  <label class="text-sm font-medium text-slate-700 lg:col-span-2">
                    Название товара *
                    <input
                      v-model="product.name"
                      class="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900"
                      autocomplete="off"
                    />
                  </label>
                  <label class="text-sm font-medium text-slate-700">
                    Размер
                    <input
                      v-model="product.size"
                      class="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900"
                      autocomplete="off"
                    />
                  </label>
                  <label class="text-sm font-medium text-slate-700">
                    Количество *
                    <input
                      v-model.number="product.quantity"
                      min="1"
                      step="1"
                      class="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900"
                      type="number"
                    />
                  </label>
                  <label class="text-sm font-medium text-slate-700">
                    Цена продажи, ₴ *
                    <input
                      v-model.number="product.price"
                      min="0"
                      step="0.01"
                      class="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900"
                      type="number"
                    />
                  </label>
                  <label class="text-sm font-medium text-slate-700">
                    Себестоимость в $ (если закупка в долларах)
                    <input
                      :value="formatOrderNumber(product.costUsd ?? 0)"
                      min="0"
                      inputmode="decimal"
                      class="mt-1 w-full rounded-lg border border-emerald-100 bg-white px-3 py-2 text-slate-900"
                      type="text"
                      @input="updateDraftUsdCost(product, $event)"
                    />
                  </label>
                  <label class="text-sm font-medium text-slate-700">
                    Себестоимость в ₴ (если закупка в гривнах) *
                    <input
                      v-model.number="product.cost"
                      min="0"
                      step="0.01"
                      class="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900"
                      type="number"
                      @input="((product.costUsd = 0), (product.costManual = true))"
                    />
                  </label>
                </div>
              </div>
            </div>
          </section>

          <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 class="text-base font-semibold text-slate-900">Доставка</h3>
            <p class="mt-1 text-xs text-slate-500">
              Если получатель и его телефон пустые, при сохранении будут использованы данные
              покупателя.
            </p>
            <div class="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <label class="text-sm font-medium text-slate-700">
                Получатель
                <input
                  v-model="orderDraft.delivery.recipient"
                  class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900"
                  autocomplete="off"
                />
              </label>
              <label class="text-sm font-medium text-slate-700">
                Телефон получателя
                <input
                  v-model="orderDraft.delivery.recipientPhone"
                  class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900"
                  inputmode="tel"
                  autocomplete="off"
                />
              </label>
              <label class="text-sm font-medium text-slate-700">
                Перевозчик
                <select
                  v-model="orderDraft.delivery.carrier"
                  class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900"
                >
                  <option v-for="carrier in carrierOptions" :key="carrier" :value="carrier">
                    {{ carrier }}
                  </option>
                </select>
              </label>
              <label class="text-sm font-medium text-slate-700">
                ТТН
                <input
                  v-model="orderDraft.delivery.ttn"
                  class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900"
                  autocomplete="off"
                />
              </label>
              <label class="text-sm font-medium text-slate-700">
                Город
                <input
                  v-model="orderDraft.delivery.city"
                  class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900"
                  autocomplete="off"
                />
              </label>
              <label class="text-sm font-medium text-slate-700">
                Отделение / адрес
                <input
                  v-model="orderDraft.delivery.address"
                  class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900"
                  autocomplete="off"
                />
              </label>
            </div>
          </section>

          <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 class="text-base font-semibold text-slate-900">Дополнительные расходы</h3>
            <div class="mt-4 grid gap-4 md:grid-cols-2">
              <label class="text-sm font-medium text-slate-700">
                Доставка, ₴
                <input
                  v-model.number="orderDraft.shipping"
                  min="0"
                  step="0.01"
                  class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900"
                  type="number"
                />
              </label>
              <label class="text-sm font-medium text-slate-700">
                Эквайринг, ₴
                <input
                  v-model.number="orderDraft.acquiring"
                  min="0"
                  step="0.01"
                  class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900"
                  type="number"
                />
              </label>
            </div>
          </section>
        </div>

        <div class="shrink-0 border-t border-slate-200 bg-white px-6 py-4">
          <p
            v-if="orderDraftError"
            class="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700"
            role="alert"
          >
            {{ orderDraftError }}
          </p>
          <div class="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              class="rounded-xl border border-slate-200 bg-white px-5 py-3 font-semibold text-slate-700 hover:bg-slate-50"
              type="button"
              @click="orderDialog?.close()"
            >
              Отмена
            </button>
            <button
              :disabled="isSavingOrderDraft"
              class="rounded-xl bg-emerald-700 px-6 py-3 font-semibold text-white hover:bg-emerald-800 disabled:cursor-wait disabled:opacity-60"
              type="submit"
            >
              {{
                isSavingOrderDraft
                  ? 'Сохраняем…'
                  : editingManualOrderId === null
                    ? 'Создать заказ'
                    : 'Сохранить изменения'
              }}
            </button>
          </div>
        </div>
      </form>
    </dialog>
    <PrintRegistry
      v-if="printRegistryMode"
      :orders="printRegistryOrders"
      :mode="printRegistryMode"
      :busy="isUpdatingPrintRegistry"
      @close="closePrintRegistry"
      @markPrinted="markPrintRegistryPrinted"
      @showHistory="showPrintRegistryHistory"
      @showDraft="showCurrentPrintRegistry"
      @checkedChange="handlePrintCheckedChange"
      @checkAll="handlePrintCheckAll"
      @restore="restorePrintedOrder"
      @restoreUnchecked="restoreUncheckedPrintedOrders"
    />
  </div>
</template>

<style scoped>
.order-edit .order-cell-edit[readonly]:focus {
  outline: none;
  box-shadow: 0 0 0 2px #60a5fa;
}

.order-edit .order-cell-edit:not([readonly]) {
  outline: none;
  background-color: #fffbeb;
  box-shadow: 0 0 0 2px #fbbf24;
}
</style>
