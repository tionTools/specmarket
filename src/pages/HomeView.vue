<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useTemplateRef } from 'vue'
import type { User } from '@supabase/supabase-js'
import { useRoute, useRouter } from 'vue-router'
import * as XLSX from 'xlsx'

import { demoOrders } from '@/features/orders/demoOrders'
import type { Delivery, Order, OrderProduct, Platform } from '@/features/orders/types'
import { supabase } from '@/lib/supabase'
import PlatformLogo from '@/components/ui/PlatformLogo.vue'
import CarrierLogo from '@/components/ui/CarrierLogo.vue'

const storageKey = 'specmarket-crm-demo-orders'
const registryDraftNavigationStorageKey = 'specmarket-crm-registry-navigation'
const route = useRoute()
const router = useRouter()
const orderDialog = useTemplateRef<HTMLDialogElement>('orderDialog')
const promRegistryFileInput = useTemplateRef<HTMLInputElement>('promRegistryFileInput')
const searchQuery = ref('')
const platformFilter = ref<'all' | Platform>('all')
const isShowingCancelledAndReturned = ref(false)
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
const commentEditorOrderId = ref<string | number | null>(null)
const editingInternalCommentOrderId = ref<string | number | null>(null)
const editingInternalCommentValue = ref<Record<string, string>>({})
const usdRate = ref(45.2)
const isSyncingEpicentr = ref(false)
const isSyncingProm = ref(false)
const isSyncingKasta = ref(false)
const isApplyingPromRegistry = ref(false)
const syncEpicentrMessage = ref('')
const syncNoticeVisible = ref(false)
type PromRegistryEntry = {
  orderNumber: string
  paymentAmount: number
  acquiring: number
  hasAcquiring: boolean
}
type RegistrySource = 'RozetkaPay' | 'NovaPay' | 'Kasta' | 'Укрпочта' | 'Meest Express'
type RegistryKeyType = 'orderNumber' | 'ttn'
type RegistryDraftNavigation = {
  entries: PromRegistryEntry[]
  fileName: string
  source: RegistrySource
  keyType: RegistryKeyType
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
const promRegistryNewFields = ref(new Set<string>())
const promRegistryMismatchedFields = ref(new Set<string>())
const promRegistryExistingFinancials = ref({ complete: 0, partial: 0 })
const expandedRegistryOrderIds = ref<Array<string | number>>([])
let persistenceQueue: Promise<void> = Promise.resolve()
let syncNoticeTimer: ReturnType<typeof window.setTimeout> | undefined
let syncNoticeCleanupTimer: ReturnType<typeof window.setTimeout> | undefined
const isGuest = computed(() => user.value?.email?.toLowerCase() === 'guest@gmail.com')

function showSyncMessage(message: string) {
  window.clearTimeout(syncNoticeTimer)
  window.clearTimeout(syncNoticeCleanupTimer)
  syncEpicentrMessage.value = message
  syncNoticeVisible.value = true
  syncNoticeTimer = window.setTimeout(() => {
    syncNoticeVisible.value = false
    syncNoticeCleanupTimer = window.setTimeout(() => {
      syncEpicentrMessage.value = ''
    }, 500)
  }, 30000)
}

function showSyncError(message: string) {
  window.clearTimeout(syncNoticeTimer)
  window.clearTimeout(syncNoticeCleanupTimer)
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
const currentMonth = () => {
  const now = new Date()
  return { month: now.getMonth() + 1, year: now.getFullYear() }
}

const getOrderAmount = (order: Order) =>
  order.products.reduce((sum, product) => sum + product.price * product.quantity, 0)
const getOrderPreviewImage = (order: Order) => order.products[0]?.imageUrl
const getProductAmount = (product: OrderProduct) => product.price * product.quantity
const getOrderCost = (order: Order) =>
  order.products.reduce((sum, product) => sum + product.cost * product.quantity, 0)
const getProductRoyalty = (order: Order, product: OrderProduct) => {
  const percent = product.royaltyPercent ?? (order.platform === 'Каста' ? 22 : 0)
  return product.royaltyAmount ?? product.price * product.quantity * (percent / 100)
}
const getRoyalty = (order: Order) =>
  order.products.reduce((sum, product) => sum + getProductRoyalty(order, product), 0)
const getPlannedProfit = (order: Order) =>
  getOrderAmount(order) * 0.983 - getOrderCost(order) - getRoyalty(order) - order.shipping
// Фактическая прибыль появляется только после ручного внесения полученной
// суммы. Статус площадки сам по себе не означает, что деньги уже получены.
const isPaid = (order: Order) => (order.paymentAmount ?? 0) > 0
const getActualProfit = (order: Order) =>
  (order.paymentAmount ?? 0) -
  getOrderCost(order) -
  getRoyalty(order) -
  order.shipping -
  order.acquiring
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
  return registrySource.value === 'Kasta' ? getOrderAmount(order) : entry.paymentAmount
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

function openPromRegistryFilePicker() {
  if (isGuest.value) return
  promRegistryFileInput.value?.click()
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
  promRegistryNewFields.value = new Set()
  promRegistryMismatchedFields.value = new Set()
  promRegistryExistingFinancials.value = { complete: 0, partial: 0 }
}

function clearPromRegistry() {
  if (isPromRegistryDraft.value) restorePromRegistryFinancials()
  promRegistryEntries.value = []
  promRegistryFileName.value = ''
  promRegistryError.value = ''
  isPromRegistryDraft.value = false
  registrySource.value = null
  registryKeyType.value = 'orderNumber'
  expandedRegistryOrderIds.value = []
  expandedOrderId.value = null
  window.sessionStorage.removeItem(registryDraftNavigationStorageKey)
  if (promRegistryFileInput.value) promRegistryFileInput.value.value = ''
}

function saveRegistryDraftNavigation() {
  if (!isPromRegistryDraft.value || !registrySource.value) return
  const draft: RegistryDraftNavigation = {
    entries: promRegistryEntries.value,
    fileName: promRegistryFileName.value,
    source: registrySource.value,
    keyType: registryKeyType.value,
  }
  window.sessionStorage.setItem(registryDraftNavigationStorageKey, JSON.stringify(draft))
}

function restoreRegistryDraftNavigation() {
  const rawDraft = window.sessionStorage.getItem(registryDraftNavigationStorageKey)
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
    window.sessionStorage.removeItem(registryDraftNavigationStorageKey)
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
    promRegistryOriginalFinancials.set(order.id, {
      paymentAmount: order.paymentAmount ?? 0,
      acquiring: order.acquiring,
      acquiringPercent: order.acquiringPercent,
    })
    const hasPayment = (order.paymentAmount ?? 0) > 0
    const hasAcquiring = order.acquiring > 0
    if (hasPayment && (!entry.hasAcquiring || hasAcquiring)) complete += 1
    else if (hasPayment || hasAcquiring) partial += 1

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
  const entry = promRegistryEntriesByOrder.value.get(registryKeyForOrder(order))
  if (!entry) return false
  if (field === 'acquiring' && !entry.hasAcquiring) return false
  const actual = field === 'paymentAmount' ? (order.paymentAmount ?? 0) : order.acquiring
  const expected =
    field === 'paymentAmount' ? getRegistryPaymentAmount(order, entry) : entry.acquiring
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
      : (entry?.acquiring ?? 0)
  if (
    isPromRegistryDraft.value &&
    isPromRegistryNewField(order, field) &&
    expected > 0 &&
    Math.abs(actual - expected) <= 0.01
  ) {
    return 'border-violet-300 bg-violet-100 text-violet-950'
  }
  return 'border-slate-200 text-slate-900'
}

async function handlePromRegistryFile(event: Event) {
  if (isGuest.value) return
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
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
                ? normalizePromRegistryHeader(cell) === 'комісія'
                : normalizePromRegistryHeader(cell) === 'сума комісії з отримувача',
          )
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
      }
      if (!isKasta) entry.paymentAmount += parsePromRegistryAmount(row[paymentColumn])
      if (!isUkrposhta && !isMeest) {
        entry.acquiring += Math.abs(parsePromRegistryAmount(row[acquiringColumn]))
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
    applyPromRegistryPreview(entries)
    saveRegistryDraftNavigation()
  } catch (error) {
    promRegistryError.value =
      error instanceof Error ? error.message : 'Не удалось прочитать реестр.'
  }
}

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
  try {
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
    promRegistryError.value =
      error instanceof Error ? error.message : 'Не удалось сохранить разнесение.'
  } finally {
    isApplyingPromRegistry.value = false
  }
}

const isInCurrentMonth = (order: Order) => {
  const [day, month, year] = order.date.split('.').map(Number)
  const current = currentMonth()
  return day !== undefined && month === current.month && year === current.year
}

function isCancelledOrReturned(order: Order) {
  return /скас|отмен|cancel|повер|возврат|return|refund/.test(
    displayOrderStatus(order.status).toLowerCase(),
  )
}

const reportOrders = computed(() => orders.value.filter((order) => !isCancelledOrReturned(order)))
const ordersForToday = computed(() =>
  reportOrders.value.filter((order) => order.date === todayKey()),
)
const ordersForMonth = computed(() => reportOrders.value.filter(isInCurrentMonth))
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
const visibleOrders = computed(() => {
  const search = searchQuery.value.trim().toLowerCase()
  const ttnSearch = search.replace(/\D/g, '')
  return orders.value.filter((order) => {
    const matchesPlatform =
      isShowingCancelledAndReturned.value ||
      platformFilter.value === 'all' ||
      order.platform === platformFilter.value
    const matchesOrderState = isPromRegistryView.value
      ? true
      : isShowingCancelledAndReturned.value
        ? isCancelledOrReturned(order)
        : !isCancelledOrReturned(order)
    const haystack =
      `${order.id} ${order.displayNumber ?? ''} ${order.customer} ${order.phone} ${order.delivery.ttn} ${order.delivery.recipient} ${order.delivery.recipientPhone} ${order.products.map((product) => product.name).join(' ')}`.toLowerCase()
    const matchesTtn =
      ttnSearch.length >= 4 && order.delivery.ttn.replace(/\D/g, '').includes(ttnSearch)
    return (
      matchesPlatform &&
      matchesOrderState &&
      (!isPromRegistryView.value || promRegistryOrders.value.includes(order)) &&
      (!search || haystack.includes(search) || matchesTtn)
    )
  })
})

function toggleCancelledAndReturned() {
  isShowingCancelledAndReturned.value = !isShowingCancelledAndReturned.value
  if (isShowingCancelledAndReturned.value) platformFilter.value = 'all'
}

const summary = computed(() => {
  const sum = (items: Order[], getter: (order: Order) => number) =>
    items.reduce((total, order) => total + getter(order), 0)
  return {
    today: {
      orders: ordersForToday.value.length,
      turnover: sum(ordersForToday.value, getOrderAmount),
      planned: sum(ordersForToday.value, getPlannedProfit),
      actual: sum(ordersForToday.value.filter(isPaid), getActualProfit),
    },
    month: {
      orders: ordersForMonth.value.length,
      turnover: sum(ordersForMonth.value, getOrderAmount),
      planned: sum(ordersForMonth.value, getPlannedProfit),
      actual: sum(ordersForMonth.value.filter(isPaid), getActualProfit),
    },
  }
})

const platformSummary = computed(() =>
  platformOptions.map((platform) => {
    const platformOrders = ordersForMonth.value.filter((order) => order.platform === platform)
    return {
      platform,
      count: platformOrders.length,
      turnover: platformOrders.reduce((sum, order) => sum + getOrderAmount(order), 0),
      planned: platformOrders.reduce((sum, order) => sum + getPlannedProfit(order), 0),
      actual: platformOrders.filter(isPaid).reduce((sum, order) => sum + getActualProfit(order), 0),
    }
  }),
)

function createProduct(): OrderProduct {
  return { id: crypto.randomUUID(), name: '', size: '', quantity: 1, price: 0, cost: 0 }
}

function updateDraftUsdCost(product: OrderProduct, event: Event) {
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
    platform: 'Пром',
    status: 'Новий',
    products: [createProduct()],
    shipping: 0,
    paymentAmount: 0,
    acquiring: 0,
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

function persistOrders(order?: Order) {
  if (isGuest.value) return Promise.resolve()
  const savedOrders = order
    ? [orderWithRegistryFinancialsRestored(order)]
    : orders.value.map(orderWithRegistryFinancialsRestored)
  const localOrders = orders.value.map(orderWithRegistryFinancialsRestored)
  persistenceQueue = persistenceQueue
    .catch((error: unknown) => console.error('Не удалось сохранить заказ:', error))
    .then(() => persistOrdersNow(savedOrders, localOrders))
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
    delivery: { ...order.delivery, paymentAmount: order.paymentAmount },
    items: order.products.map((product) => ({
      product_name: product.name,
      size: product.size,
      quantity: product.quantity,
      price: product.price,
      image_url: product.imageUrl ?? null,
      cost: product.cost,
      cost_usd: product.costUsd ?? 0,
      royalty_percent: product.royaltyPercent ?? null,
      royalty_amount: product.royaltyAmount ?? null,
    })),
  }
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

async function syncEpicentrOrders(full = false) {
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
    showSyncError(data?.message ?? error?.message ?? 'Не удалось обновить заказы Эпицентра.')
    return
  }
  showSyncMessage(
    full
      ? `Эпицентр: полная синхронизация — найдено ${data.received}, обновлено ${data.updated}, добавлено ${data.created}.`
      : `Эпицентр: найдено ${data.received}, добавлено новых ${data.created}, уже есть ${data.skipped ?? 0} — не изменены.`,
  )
  await loadRemoteOrders()
}

async function syncNewEpicentrOrders() {
  await syncEpicentrOrders()
}

async function syncPromOrders(full = false) {
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
    showSyncError(data?.message ?? error?.message ?? 'Не удалось обновить заказы Prom.')
    return
  }
  showSyncMessage(
    full
      ? `Prom: полная синхронизация — найдено ${data.received}, обновлено ${data.updated}, добавлено ${data.created}.`
      : `Prom: найдено ${data.received}, добавлено новых ${data.created}, уже есть ${data.skipped ?? 0} — не изменены.`,
  )
  await loadRemoteOrders()
}

async function syncNewPromOrders() {
  await syncPromOrders()
}

async function syncFullEpicentrOrders() {
  if (!window.confirm('Полная синхронизация обновит все доступные заказы Эпицентра. Продолжить?'))
    return
  await syncEpicentrOrders(true)
}

async function syncFullPromOrders() {
  if (!window.confirm('Полная синхронизация обновит все доступные заказы Prom. Продолжить?')) return
  await syncPromOrders(true)
}

async function syncKastaOrders(full = false, latest = false) {
  if (!supabase || isGuest.value || isSyncingKasta.value) return
  isSyncingKasta.value = true
  if (!(await waitForPendingSaves())) {
    isSyncingKasta.value = false
    return
  }
  syncEpicentrMessage.value = ''
  const { data, error } = await supabase.functions.invoke('sync-kasta-orders', {
    method: 'POST',
    body: full
      ? latest
        ? { full: true, latest: true }
        : { full: true }
      : latest
        ? { latest: true }
        : undefined,
  })
  isSyncingKasta.value = false
  if (error || !data?.ok) {
    showSyncError(data?.message ?? error?.message ?? 'Не удалось обновить заказы Касты.')
    return
  }
  showSyncMessage(
    full
      ? `Каста: полная синхронизация — найдено ${data.received}, обновлено ${data.updated}, добавлено ${data.created}.`
      : latest
        ? `Каста: последние заказы — найдено ${data.received}, добавлено ${data.created}, уже есть ${data.skipped ?? 0}.`
        : `Каста: найдено ${data.received}, добавлено новых ${data.created}, уже есть ${data.skipped ?? 0} — не изменены.`,
  )
  await loadRemoteOrders()
}

async function syncNewKastaOrders() {
  await syncKastaOrders()
}

async function syncFullKastaOrders() {
  if (
    !window.confirm(
      'Загрузить последние 100 заказов Касты и перевести обычную синхронизацию на актуальный курсор?',
    )
  )
    return
  await syncKastaOrders(true, true)
}

async function syncKastaOrder(order: Order) {
  if (
    !supabase ||
    isGuest.value ||
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
  await reloadOrdersAfterManualSync()
}

async function syncPromOrder(order: Order) {
  if (
    !supabase ||
    isGuest.value ||
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
  await reloadOrdersAfterManualSync()
}

async function syncEpicentrOrder(order: Order) {
  if (
    !supabase ||
    isGuest.value ||
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
  await reloadOrdersAfterManualSync()
}

function orderSyncSnapshot(order: Order) {
  return {
    acquiring: order.acquiring,
    acquiringPercent: order.acquiringPercent ?? null,
    items: order.products.map((product) => ({
      name: product.name,
      cost: product.cost,
      costUsd: product.costUsd ?? 0,
      royaltyPercent: product.royaltyPercent ?? null,
      royaltyAmount: product.royaltyAmount ?? null,
    })),
  }
}

async function reloadOrdersAfterManualSync() {
  await loadRemoteOrders()
  if (isPromRegistryDraft.value) applyPromRegistryPreview(promRegistryEntries.value)
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
  const { data: remoteOrders } = await supabase
    .from('crm_orders')
    .select('*, crm_order_items(*)')
    .order('created_at', { ascending: false })
  if (!remoteOrders?.length) {
    await persistOrders()
    return
  }
  orders.value = remoteOrders
    .map((row) => ({
      id: row.order_label ?? String(row.order_number),
      orderNumber: Number(row.order_number),
      displayNumber: row.order_label ?? undefined,
      remoteId: row.id,
      externalId: row.external_id ?? undefined,
      date: row.order_date,
      time: row.order_time ?? undefined,
      customer: row.customer,
      phone: row.phone,
      customerEmail: row.customer_email ?? undefined,
      customerComment: row.customer_comment ?? undefined,
      internalComment: row.internal_comment ?? undefined,
      platform: row.platform as Platform,
      status: row.status,
      shipping: Number(row.shipping),
      paymentAmount: Number((row.delivery as Delivery).paymentAmount ?? 0),
      acquiring: Number(row.acquiring),
      acquiringPercent: row.acquiring_percent === null ? undefined : Number(row.acquiring_percent),
      delivery: row.delivery as Delivery,
      products: (
        row.crm_order_items as Array<{
          id: string
          position: number
          product_name: string
          size: string | null
          image_url: string | null
          quantity: number
          price: number
          cost: number
          cost_usd: number
          royalty_percent: number | null
          royalty_amount: number | null
        }>
      )
        .sort((a, b) => a.position - b.position)
        .map((item) => ({
          id: item.id,
          name: item.product_name,
          size: item.size ?? '',
          imageUrl: item.image_url ?? undefined,
          quantity: Number(item.quantity),
          price: Number(item.price),
          cost: Number(item.cost),
          costUsd: Number(item.cost_usd ?? 0),
          royaltyPercent: item.royalty_percent === null ? undefined : Number(item.royalty_percent),
          royaltyAmount: item.royalty_amount === null ? undefined : Number(item.royalty_amount),
        })),
    }))
    .sort(
      (left, right) =>
        orderDateTime(right) - orderDateTime(left) ||
        (right.orderNumber ?? 0) - (left.orderNumber ?? 0),
    )
}

onMounted(async () => {
  await loadRemoteOrders()
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

function openNewOrderDialog() {
  if (isGuest.value) return
  orderDraft.value = createOrderDraft()
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

function createOrder() {
  if (isGuest.value) return
  orders.value.unshift(structuredClone(orderDraft.value))
  persistOrders()
  orderDialog.value?.close()
}

function updateOrderStatus(order: Order, status: string) {
  if (isGuest.value) return
  order.status = status
  persistOrders(order)
}

function toggleOrder(orderId: string | number) {
  if (isPromRegistryDraft.value) {
    expandedRegistryOrderIds.value = expandedRegistryOrderIds.value.includes(orderId)
      ? expandedRegistryOrderIds.value.filter((id) => id !== orderId)
      : [...expandedRegistryOrderIds.value, orderId]
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
  }
  return names[status.toLowerCase()] ?? status
}

function displayDeliveryStatus(status: string) {
  const names: Record<string, string> = {
    received: 'Получено',
    delivered: 'Получено',
    in_transit: 'В дороге',
    on_the_way: 'На шляху до одержувача',
    shipped: 'Отправлено',
  }
  return names[status.toLowerCase()] ?? status
}

function deliveryStatusForOrder(order: Order) {
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

function displayCarrier(carrier: string) {
  const names: Record<string, string> = {
    nova_poshta: 'Нова пошта',
    ukrposhta: 'Укрпошта',
    cvz_epicentr: 'ЦВЗ Епіцентр',
    parcel_box_epicentr: 'Поштомат Епіцентр',
  }
  return names[carrier.toLowerCase()] ?? carrier
}

function carrierIcon(carrier: string): 'nova' | 'ukr' | 'rozetka' | 'meest' | 'generic' {
  const value = carrier.toLowerCase()
  if (value.includes('nova') || value.includes('новая') || value.includes('нова пошта'))
    return 'nova'
  if (value.includes('ukr') || value.includes('укр')) return 'ukr'
  if (value.includes('rozetka')) return 'rozetka'
  if (value.includes('meest') || value.includes('міст')) return 'meest'
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
  const names: Record<string, string> = {
    monobank: 'Оплата через Монобанк',
    postpayment: 'Післяплата',
    cash_on_delivery: 'Післяплата',
    cod: 'Післяплата',
    invoice: 'Оплата по рахунку',
  }
  return names[method.toLowerCase()] ?? method
}

function displayDeliveryAddress(delivery: Delivery) {
  return [delivery.city, delivery.address].filter(Boolean).join(', ') || '—'
}

async function copyOrderNumber(order: Order) {
  await navigator.clipboard.writeText(order.displayNumber ?? String(order.id))
}

async function copyTtn(ttn: string) {
  if (!ttn) return
  await navigator.clipboard.writeText(ttn)
}

function openEpicentrOrder(order: Order) {
  if (!order.externalId) return
  window.open(
    `https://admin.epicentrm.com.ua/oms/orders/${order.externalId}`,
    '_blank',
    'noopener,noreferrer',
  )
}

function openPromOrder(order: Order) {
  const promId = String(order.externalId ?? order.id).replace(/^prom:/, '')
  if (!promId) return
  window.open(`https://my.prom.ua/cms/order/edit/${promId}`, '_blank', 'noopener,noreferrer')
}

function openKastaOrder(order: Order) {
  const kastaId = String(order.externalId ?? order.id).replace(/^kasta:/, '')
  if (!kastaId) return
  window.open(
    `https://hub.kasta.ua/customer-orders/all?order=${encodeURIComponent(kastaId)}`,
    '_blank',
    'noopener,noreferrer',
  )
}

function syncProductRoyaltyAmount(order: Order, product: OrderProduct) {
  product.royaltyAmount = product.price * product.quantity * ((product.royaltyPercent ?? 0) / 100)
  persistOrders(order)
}

function syncProductRoyaltyPercent(order: Order, product: OrderProduct) {
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
  product.royaltyAmount = product.price * product.quantity * ((product.royaltyPercent ?? 0) / 100)
}

function updateProductRoyaltyAmount(product: OrderProduct, key: string, event: Event) {
  const raw = (event.target as HTMLInputElement).value
  editingOrderValue.value[key] = raw
  product.royaltyAmount = parseOrderNumber(event)
  const amount = product.price * product.quantity
  product.royaltyPercent = amount === 0 ? 0 : ((product.royaltyAmount ?? 0) / amount) * 100
}

function orderCellValue(key: string, value: number | undefined) {
  return editingOrderValue.value[key] ?? formatOrderNumber(value)
}

function updateOrderFinancial(
  order: Order,
  field: 'shipping' | 'paymentAmount' | 'acquiring' | 'acquiringPercent',
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
    product.costUsd = value
    if (value !== 0) product.cost = value * usdRate.value
    return
  }
  product[field] = value
  if (field === 'cost') product.costUsd = 0
}

function finishOrderCell(key: string, onCommit?: () => void) {
  if (editingOrderCell.value === key) {
    const order = orderFromEditKey(key)
    onCommit?.()
    editingOrderCell.value = null
    delete editingOrderValue.value[key]
    persistOrders(order)
  }
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
    <RouterLink
      class="fixed right-0 top-1/2 z-50 flex -translate-y-1/2 cursor-pointer flex-col items-center gap-0.5 rounded-l-xl border border-emerald-300 bg-white px-2 py-3 text-sm font-bold leading-none text-emerald-800 shadow-lg transition hover:bg-emerald-50"
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
    <div class="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header class="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p class="text-xs font-bold tracking-[0.2em] text-emerald-700">SPECMARKET CRM</p>
          <h1 class="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Заказы</h1>
          <p
            class="mt-2 inline-flex rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800"
          >
            Общие данные: цены и заказы синхронизируются через Supabase
          </p>
        </div>
        <div class="flex flex-wrap gap-3">
          <input
            ref="promRegistryFileInput"
            class="hidden"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            @change="handlePromRegistryFile"
          />
          <button
            v-if="!isGuest"
            class="rounded-xl border border-violet-200 bg-white px-4 py-3 text-sm font-semibold text-violet-700 shadow-sm transition hover:bg-violet-50"
            type="button"
            @click="openPromRegistryFilePicker"
          >
            ↑ Импортировать реестр
          </button>
          <button
            class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 shadow-sm hover:border-rose-200 hover:text-rose-700"
            type="button"
            @click="signOut"
          >
            Выйти
          </button>
          <RouterLink
            class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-emerald-300 hover:text-emerald-800"
            to="/prices"
          >
            Цены
          </RouterLink>
          <button
            v-if="!isGuest"
            class="rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm font-semibold text-emerald-800 shadow-sm transition hover:bg-emerald-50 disabled:cursor-wait disabled:opacity-60"
            :disabled="isSyncingEpicentr"
            type="button"
            @click="syncNewEpicentrOrders"
          >
            {{ isSyncingEpicentr ? 'Ищем новые в Эпицентре…' : '↻ Загрузить новые Эпицентр' }}
          </button>
          <button
            v-if="!isGuest"
            class="rounded-xl border border-blue-200 bg-white px-4 py-3 text-sm font-semibold text-blue-700 shadow-sm transition hover:bg-blue-50 disabled:cursor-wait disabled:opacity-60"
            :disabled="isSyncingProm"
            type="button"
            @click="syncNewPromOrders"
          >
            {{ isSyncingProm ? 'Ищем новые в Prom…' : '↻ Загрузить новые Prom' }}
          </button>
          <button
            v-if="!isGuest"
            class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 shadow-sm transition hover:bg-amber-100 disabled:cursor-wait disabled:opacity-60"
            :disabled="isSyncingEpicentr"
            type="button"
            @click="syncFullEpicentrOrders"
          >
            {{ isSyncingEpicentr ? 'Синхронизация…' : '↻ Полная Эпицентр' }}
          </button>
          <button
            v-if="!isGuest"
            class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 shadow-sm transition hover:bg-amber-100 disabled:cursor-wait disabled:opacity-60"
            :disabled="isSyncingProm"
            type="button"
            @click="syncFullPromOrders"
          >
            {{ isSyncingProm ? 'Синхронизация…' : '↻ Полная Prom' }}
          </button>
          <button
            v-if="!isGuest"
            class="rounded-xl border border-orange-200 bg-white px-4 py-3 text-sm font-semibold text-orange-700 shadow-sm transition hover:bg-orange-50 disabled:cursor-wait disabled:opacity-60"
            :disabled="isSyncingKasta"
            type="button"
            @click="syncNewKastaOrders"
          >
            {{ isSyncingKasta ? 'Ищем новые в Касте…' : '↻ Загрузить новые Каста' }}
          </button>
          <button
            v-if="!isGuest"
            class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 shadow-sm transition hover:bg-amber-100 disabled:cursor-wait disabled:opacity-60"
            :disabled="isSyncingKasta"
            type="button"
            @click="syncFullKastaOrders"
          >
            {{ isSyncingKasta ? 'Синхронизация…' : '↻ Последние 100 Каста' }}
          </button>
          <button
            v-if="!isGuest"
            class="rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800"
            type="button"
            @click="openNewOrderDialog"
          >
            + Новый заказ
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
        class="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900 transition-opacity duration-500"
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
          частично. Эти значения оставлены белыми; сиреневым отмечены только поля, которые
          дозаполнил этот черновик.
        </p>
        <p
          v-if="isPromRegistryDraft && promRegistryMismatchCount"
          class="mt-3 rounded-xl border border-amber-300 bg-amber-100 px-3 py-2 text-sm font-medium text-amber-950"
        >
          Расхождений с {{ registrySourceLabel }}: {{ promRegistryMismatchCount }}. Такие поля
          отмечены янтарным и не будут заменены автоматически.
        </p>
      </section>

      <section class="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p class="text-sm text-slate-500">Заказы</p>
          <p class="mt-2 text-3xl font-semibold">{{ summary.today.orders }}</p>
          <p class="mt-2 text-xs text-slate-500">
            За месяц: <span class="font-semibold text-slate-800">{{ summary.month.orders }}</span>
          </p>
        </article>
        <article class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p class="text-sm text-slate-500">Оборот</p>
          <p class="mt-2 text-3xl font-semibold">{{ formatMoney(summary.today.turnover) }}</p>
          <p class="mt-2 text-xs text-slate-500">
            За месяц:
            <span class="font-semibold text-slate-800">{{
              formatMoney(summary.month.turnover)
            }}</span>
          </p>
        </article>
        <article class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p class="text-sm text-slate-500">Плановая прибыль</p>
          <p class="mt-2 text-3xl font-semibold">{{ formatMoney(summary.today.planned) }}</p>
          <p class="mt-2 text-xs text-slate-500">
            За месяц:
            <span class="font-semibold text-slate-800">{{
              formatMoney(summary.month.planned)
            }}</span>
          </p>
        </article>
        <article class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p class="text-sm text-slate-500">Фактическая прибыль</p>
          <p class="mt-2 text-3xl font-semibold">{{ formatMoney(summary.today.actual) }}</p>
          <p class="mt-2 text-xs text-slate-500">
            За месяц:
            <span class="font-semibold text-slate-800">{{
              formatMoney(summary.month.actual)
            }}</span>
          </p>
        </article>
      </section>

      <section class="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p class="text-xs font-bold tracking-[0.16em] text-emerald-700">ТЕКУЩИЙ МЕСЯЦ</p>
            <h2 class="mt-1 text-xl font-semibold">По площадкам</h2>
          </div>
          <p class="text-xs text-slate-500">Оборот · План · Факт</p>
        </div>
        <div class="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <article
            v-for="item in platformSummary"
            :key="item.platform"
            class="rounded-xl bg-slate-50 p-4"
          >
            <p class="font-bold"><PlatformLogo :platform="item.platform" /></p>
            <p class="mt-3 text-xs text-slate-500">Заказов: {{ item.count }}</p>
            <p class="text-xs text-slate-500">Оборот: {{ formatMoney(item.turnover) }}</p>
            <p class="text-xs text-slate-500">План: {{ formatMoney(item.planned) }}</p>
            <p class="text-xs text-slate-500">Факт: {{ formatMoney(item.actual) }}</p>
          </article>
        </div>
      </section>

      <section class="mt-6 rounded-2xl border-2 border-slate-300 bg-slate-100 p-3 shadow-sm">
        <div
          class="flex flex-col gap-3 rounded-xl border border-slate-300 bg-white p-4 sm:flex-row"
        >
          <div class="relative w-full sm:max-w-md">
            <svg
              class="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-slate-500"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-4-4" />
            </svg>
            <input
              v-model="searchQuery"
              class="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-10 pr-10 text-sm outline-none transition focus:border-emerald-600"
              placeholder="Поиск: заказ, ТТН, покупатель, товар"
            />
            <button
              v-if="searchQuery"
              class="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-700"
              type="button"
              aria-label="Очистить поиск"
              @click="searchQuery = ''"
            >
              ×
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
        </div>
        <div
          class="mt-3 hidden grid-cols-[0.95fr_0.8fr_minmax(19rem,2.2fr)_0.75fr_0.95fr_1fr_1.1fr_4.5rem] gap-3 px-5 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 lg:grid"
        >
          <span>Номер заказа</span><span>Площадка<br />Статус</span><span>Товары</span
          ><span>Сумма заказа</span><span>Факт. прибыль</span><span>План. прибыль</span
          ><span>Состояние отгрузки</span><span />
        </div>
        <article
          v-for="order in visibleOrders"
          :key="order.id"
          :id="`order-${order.id}`"
          class="mb-3 overflow-hidden rounded-xl border bg-white shadow-sm transition"
          :class="
            isOrderExpanded(order)
              ? 'border-emerald-600 ring-2 ring-emerald-200 shadow-emerald-100'
              : 'border-slate-300 hover:border-slate-400'
          "
        >
          <button
            class="grid w-full gap-3 px-5 py-4 text-left transition lg:grid-cols-[0.95fr_0.8fr_minmax(19rem,2.2fr)_0.75fr_0.95fr_1fr_1.1fr_4.5rem] lg:items-center"
            :class="
              isOrderExpanded(order) ? 'bg-slate-200/80 hover:bg-slate-200' : 'hover:bg-slate-50'
            "
            type="button"
            @click="toggleOrder(order.id)"
          >
            <span
              ><span class="inline-flex items-center gap-1.5 whitespace-nowrap"
                ><span
                  v-if="order.platform === 'Эпицентр' && order.externalId"
                  class="cursor-pointer rounded-md bg-indigo-100 p-1 text-indigo-700 ring-1 ring-indigo-200 transition hover:bg-indigo-200 hover:text-indigo-900"
                  title="Открыть заказ в Эпицентре"
                  @click.stop="openEpicentrOrder(order)"
                  ><svg
                    class="size-5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    aria-hidden="true"
                  >
                    <path
                      d="M10 13.8a4.5 4.5 0 0 0 6.36.06l2.12-2.12a4.5 4.5 0 0 0-6.36-6.36L8.9 6.6"
                    />
                    <path
                      d="M14 10.2a4.5 4.5 0 0 0-6.36-.06l-2.12 2.12a4.5 4.5 0 0 0 6.36 6.36l1.22-1.22"
                    /></svg></span
                ><span
                  v-if="order.platform === 'Пром' && order.externalId"
                  class="cursor-pointer rounded-md bg-indigo-100 p-1 text-indigo-700 ring-1 ring-indigo-200 transition hover:bg-indigo-200 hover:text-indigo-900"
                  title="Открыть заказ в Prom"
                  @click.stop="openPromOrder(order)"
                  ><svg
                    class="size-5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    aria-hidden="true"
                  >
                    <path
                      d="M10 13.8a4.5 4.5 0 0 0 6.36.06l2.12-2.12a4.5 4.5 0 0 0-6.36-6.36L8.9 6.6"
                    />
                    <path
                      d="M14 10.2a4.5 4.5 0 0 0-6.36-.06l-2.12 2.12a4.5 4.5 0 0 0 6.36 6.36l1.22-1.22"
                    /></svg></span
                ><span
                  v-if="order.platform === 'Каста' && order.externalId"
                  class="cursor-pointer rounded-md bg-indigo-100 p-1 text-indigo-700 ring-1 ring-indigo-200 transition hover:bg-indigo-200 hover:text-indigo-900"
                  title="Открыть заказ в Каста"
                  @click.stop="openKastaOrder(order)"
                  ><svg
                    class="size-5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    aria-hidden="true"
                  >
                    <path
                      d="M10 13.8a4.5 4.5 0 0 0 6.36.06l2.12-2.12a4.5 4.5 0 0 0-6.36-6.36L8.9 6.6"
                    />
                    <path
                      d="M14 10.2a4.5 4.5 0 0 0-6.36-.06l-2.12 2.12a4.5 4.5 0 0 0 6.36 6.36l1.22-1.22"
                    /></svg></span
                ><strong>{{ order.displayNumber ?? order.id }}</strong
                ><span
                  class="inline-flex items-center gap-1 align-middle text-sm font-semibold text-slate-400"
                  ><span
                    class="cursor-pointer rounded p-1 text-violet-600 hover:bg-violet-100 hover:text-violet-800"
                    title="Скопировать номер"
                    @click.stop="copyOrderNumber(order)"
                    ><svg
                      class="size-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.25"
                      aria-hidden="true"
                    >
                      <rect x="9" y="9" width="11" height="11" rx="2" />
                      <path
                        d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"
                      /></svg></span></span></span
              ><span class="mt-1 block text-xs text-slate-500"
                >{{ order.date }}<template v-if="order.time"> · {{ order.time }}</template></span
              ></span
            ><span
              ><strong :class="platformClass(order.platform)"
                ><PlatformLogo :platform="order.platform" /></strong
              ><span
                class="mt-1 block w-fit rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700"
                >{{ displayOrderStatus(order.status) }}</span
              ></span
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
                  v-if="order.delivery.hasWebsiteCommission"
                  class="ml-2 mt-1 inline-flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-1 text-xs font-medium text-slate-900"
                  ><span aria-hidden="true">◎</span> Замовлення з сайту</span
                ></span
              ></span
            ><strong>{{ formatMoney(getOrderAmount(order)) }}</strong
            ><span v-if="isPaid(order)"
              ><strong>{{ formatMoney(getActualProfit(order)) }}</strong>
              <span class="text-xs text-slate-500"
                >({{ formatProfitPercent(getActualProfit(order), getOrderAmount(order)) }})</span
              ></span
            ><strong v-else>—</strong
            ><span
              ><strong>{{ formatMoney(getPlannedProfit(order)) }}</strong>
              <span class="text-xs text-slate-500"
                >({{ formatProfitPercent(getPlannedProfit(order), getOrderAmount(order)) }})</span
              ></span
            ><span
              class="w-fit rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700"
              >{{ deliveryStatusForOrder(order) }}</span
            ><span class="flex items-center justify-end gap-2"
              ><span
                v-if="!isGuest"
                class="grid size-7 place-items-center rounded-md border border-rose-200 bg-white text-sm font-bold text-rose-600 hover:bg-rose-50"
                role="button"
                tabindex="0"
                title="Удалить заказ из CRM"
                aria-label="Удалить заказ из CRM"
                @click.stop="deleteOrder(order)"
                @keydown.enter.stop="deleteOrder(order)"
                >{{ deletingOrderId === order.id ? '…' : '🗑' }}</span
              ></span
            >
          </button>
          <div
            v-if="isOrderExpanded(order)"
            class="grid gap-5 bg-slate-200/80 p-5 lg:grid-cols-[minmax(0,1fr)_21rem]"
            @click="handleOrderWorkspaceClick(order, $event)"
          >
            <section :class="{ 'pointer-events-none select-none opacity-75': isGuest }">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <h3 class="text-base font-semibold">Состав заказа</h3>
                <div class="flex flex-wrap items-center gap-3">
                  <button
                    v-if="order.platform === 'Эпицентр' && order.externalId"
                    class="rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-wait disabled:opacity-60"
                    type="button"
                    :disabled="isSyncingEpicentr"
                    @click="syncEpicentrOrder(order)"
                  >
                    {{ isSyncingEpicentr ? 'Синхронизация…' : '↻ Синхронизировать заказ' }}
                  </button>
                  <button
                    v-if="order.platform === 'Пром' && order.externalId"
                    class="rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-wait disabled:opacity-60"
                    type="button"
                    :disabled="isSyncingProm"
                    @click="syncPromOrder(order)"
                  >
                    {{ isSyncingProm ? 'Синхронизация…' : '↻ Синхронизировать заказ' }}
                  </button>
                  <button
                    v-if="order.platform === 'Каста' && order.externalId"
                    class="rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-wait disabled:opacity-60"
                    type="button"
                    :disabled="isSyncingKasta"
                    @click="syncKastaOrder(order)"
                  >
                    {{ isSyncingKasta ? 'Синхронизация…' : '↻ Синхронизировать заказ' }}
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
                    <span v-if="order.platform === 'Эпицентр'" class="text-slate-500">{{
                      order.delivery.isAlternateRecipient ? 'Другой получатель' : 'Клиент'
                    }}</span>
                    <span
                      ><span class="text-slate-500">Телефон: </span
                      ><strong>{{
                        order.phone || order.delivery.recipientPhone || '—'
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
                    💬
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
                  class="order-edit grid gap-2 border-b-2 border-slate-300 p-4 last:border-b-0 sm:grid-cols-[minmax(12rem,1fr)_3rem_3.5rem_4rem_3.3rem_4rem_10rem] sm:items-end"
                >
                  <div class="flex min-w-0 gap-3">
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
                    <div class="min-w-0">
                      <strong>{{ product.name }}</strong
                      ><span class="mt-1 block text-sm text-slate-500"
                        >Размер: {{ product.size }}</span
                      >
                    </div>
                  </div>
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
                      :value="orderCellValue(`${order.id}-${product.id}-price`, product.price)"
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
                        orderCellValue(`${order.id}-${product.id}-cost-usd`, product.costUsd ?? 0)
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
                        updateOrderNumber(product, 'cost', `${order.id}-${product.id}-cost`, $event)
                      "
                      @blur="finishOrderCell(`${order.id}-${product.id}-cost`)"
                      @keydown.enter.prevent="
                        toggleOrderCell(`${order.id}-${product.id}-cost`, $event)
                      "
                  /></label>
                  <div class="grid grid-cols-2 gap-1.5">
                    <label class="text-xs font-medium text-slate-500"
                      >Роялти,<br />%<input
                        :value="
                          orderCellValue(
                            `${order.id}-${product.id}-royalty-percent`,
                            product.royaltyPercent ?? (order.platform === 'Каста' ? 22 : 0),
                          )
                        "
                        :readonly="editingOrderCell !== `${order.id}-${product.id}-royalty-percent`"
                        class="order-cell-edit mt-1 w-full rounded-lg border border-orange-100 px-2 py-1.5 text-sm font-semibold text-slate-900"
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
                          toggleOrderCell(`${order.id}-${product.id}-royalty-percent`, $event, () =>
                            syncProductRoyaltyAmount(order, product),
                          )
                        " /></label
                    ><label class="text-xs font-medium text-slate-500"
                      >Роялти,<br />₴<input
                        :value="
                          orderCellValue(
                            `${order.id}-${product.id}-royalty-amount`,
                            getProductRoyalty(order, product),
                          )
                        "
                        :readonly="editingOrderCell !== `${order.id}-${product.id}-royalty-amount`"
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
                          toggleOrderCell(`${order.id}-${product.id}-royalty-amount`, $event, () =>
                            syncProductRoyaltyPercent(order, product),
                          )
                        "
                    /></label>
                  </div>
                </div>
              </div>
              <div
                data-order-card
                class="order-edit mt-4 grid grid-cols-2 gap-3 rounded-xl border border-slate-300 bg-white p-4 text-sm sm:grid-cols-3 lg:grid-cols-6"
              >
                <div>
                  <span class="text-slate-500">Итого продажа</span
                  ><strong class="mt-1 block text-base">{{
                    formatMoney(getOrderAmount(order))
                  }}</strong>
                </div>
                <div>
                  <span class="text-slate-500">Итого с/с</span
                  ><strong class="mt-1 block text-base">{{
                    formatMoney(getOrderCost(order))
                  }}</strong>
                </div>
                <div>
                  <span class="text-slate-500">Роялти</span
                  ><strong class="mt-1 block text-base">{{
                    formatMoney(getRoyalty(order))
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
                <div class="grid grid-cols-2 gap-2">
                  <label class="text-slate-500"
                    >Экв., %<input
                      :value="
                        orderCellValue(`${order.id}-acquiring-percent`, order.acquiringPercent ?? 0)
                      "
                      :readonly="editingOrderCell !== `${order.id}-acquiring-percent`"
                      class="order-cell-edit mt-1 block w-full rounded-lg border px-2 py-1 text-sm font-semibold"
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
                      " /></label
                  ><label class="text-slate-500"
                    >Экв., ₴<input
                      :value="orderCellValue(`${order.id}-acquiring`, order.acquiring)"
                      :readonly="editingOrderCell !== `${order.id}-acquiring`"
                      class="order-cell-edit mt-1 block w-full rounded-lg border px-2 py-1 text-sm font-semibold"
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
                  /></label>
                </div>
              </div>
              <label
                v-if="isInternalCommentVisible(order)"
                data-order-card
                class="mt-4 block rounded-xl border border-slate-300 bg-white p-4 text-sm text-slate-500"
                >Комментарий к заказу<textarea
                  :value="internalCommentValue(order)"
                  :readonly="isGuest || editingInternalCommentOrderId !== order.id"
                  class="mt-2 block min-h-20 w-full resize-y rounded-lg border px-3 py-2 text-sm text-slate-900 outline-none transition"
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
              <dl class="mt-4 text-sm">
                <div class="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                  <div class="grid grid-cols-2 gap-x-4 gap-y-3">
                    <div class="min-w-0">
                      <dt class="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                        Перевозчик
                      </dt>
                      <dd class="mt-1 flex min-w-0 items-center gap-2 font-semibold">
                        <CarrierLogo
                          v-if="carrierLogoKind(order) !== 'generic'"
                          :kind="carrierLogoKind(order)"
                        />
                        <template v-else>
                          <svg
                            v-if="carrierIcon(order.delivery.carrier) === 'nova'"
                            aria-label="Новая почта"
                            class="size-5 shrink-0 text-red-500"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2.8"
                          >
                            <path
                              d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"
                            />
                          </svg>
                          <svg
                            v-else-if="carrierIcon(order.delivery.carrier) === 'ukr'"
                            aria-label="Укрпочта"
                            class="size-5 shrink-0 text-yellow-500"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2.4"
                          >
                            <path d="M3 7h18v11H3zM3 8l9 6 9-6" />
                          </svg>
                          <svg
                            v-else-if="carrierIcon(order.delivery.carrier) === 'rozetka'"
                            aria-label="RozetkaDelivery"
                            class="size-5 shrink-0 text-emerald-600"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2.2"
                          >
                            <path
                              d="M4 7h11v10H4zM15 10h3l2 3v4h-5zM7 20a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM17 20a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"
                            />
                          </svg>
                          <svg
                            v-else-if="carrierIcon(order.delivery.carrier) === 'meest'"
                            aria-label="Meest"
                            class="size-5 shrink-0 text-sky-600"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2.5"
                          >
                            <path d="M3 17V7l4 6 5-8 5 8 4-6v10" />
                          </svg>
                          <svg
                            v-else
                            aria-hidden="true"
                            class="size-5 shrink-0 text-slate-500"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                          >
                            <path
                              d="M3 7h11v10H3zM14 10h3l3 3v4h-6zM7 20a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM17 20a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"
                            />
                          </svg>
                        </template>
                        <span class="min-w-0 truncate">{{
                          displayCarrier(order.delivery.carrier)
                        }}</span>
                      </dd>
                    </div>
                    <div class="min-w-0">
                      <dt class="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                        ТТН
                      </dt>
                      <dd class="mt-1 flex min-w-0 items-center gap-1 font-semibold text-blue-700">
                        <span class="min-w-0 truncate">{{ order.delivery.ttn || '—' }}</span>
                        <button
                          v-if="order.delivery.ttn"
                          class="grid size-6 shrink-0 place-items-center rounded text-violet-600 hover:bg-violet-100 hover:text-violet-800"
                          title="Скопировать номер ТТН"
                          type="button"
                          @click="copyTtn(order.delivery.ttn)"
                        >
                          <svg
                            class="size-4"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2.25"
                            aria-hidden="true"
                          >
                            <rect x="9" y="9" width="11" height="11" rx="2" />
                            <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
                          </svg>
                        </button>
                      </dd>
                    </div>
                  </div>
                </div>
                <div class="my-3 border-t border-slate-200"></div>
                <div class="grid grid-cols-2 gap-x-4 gap-y-3">
                  <div class="min-w-0">
                    <dt class="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                      Получатель
                    </dt>
                    <dd class="mt-1 break-words font-semibold">{{ order.delivery.recipient }}</dd>
                  </div>
                  <div class="min-w-0">
                    <dt class="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                      Телефон
                    </dt>
                    <dd class="mt-1 break-all font-semibold">
                      {{ order.delivery.recipientPhone }}
                    </dd>
                  </div>
                </div>
                <div class="my-3 border-t border-slate-200"></div>
                <div>
                  <dt class="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                    Адрес
                  </dt>
                  <dd class="mt-1 break-words font-semibold">
                    {{ displayDeliveryAddress(order.delivery) }}
                  </dd>
                </div>
                <div class="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                  <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-4">
                    <div class="min-w-0">
                      <dt class="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                        Способ оплаты
                      </dt>
                      <dd class="mt-1 break-words font-semibold">
                        {{ displayPaymentMethod(order.delivery.paymentMethod) }}
                      </dd>
                    </div>
                    <div class="grid grid-cols-2 gap-3 text-right">
                      <div>
                        <dt
                          class="whitespace-nowrap text-[11px] font-semibold tracking-wide text-slate-500 uppercase"
                        >
                          Оценочная
                        </dt>
                        <dd class="mt-1 whitespace-nowrap font-semibold">
                          {{ formatMoney(getOrderAmount(order)) }}
                        </dd>
                      </div>
                      <div>
                        <dt
                          class="whitespace-nowrap text-[11px] font-semibold tracking-wide text-slate-500 uppercase"
                        >
                          Доставка
                        </dt>
                        <dd class="mt-1 whitespace-nowrap font-semibold">
                          {{ formatMoney(order.shipping) }}
                        </dd>
                      </div>
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
        <div
          v-if="isPromRegistryView"
          class="sticky bottom-4 z-10 mt-5 flex flex-wrap justify-end gap-3 rounded-2xl border border-violet-200 bg-violet-50/95 p-4 shadow-lg backdrop-blur"
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
      class="w-[min(42rem,calc(100%-2rem))] rounded-2xl border border-slate-200 p-0 shadow-2xl backdrop:bg-slate-950/35"
    >
      <form class="p-6" @submit.prevent="createOrder">
        <div class="flex items-center justify-between">
          <h2 class="text-xl font-semibold">Новый заказ</h2>
          <button class="text-2xl text-slate-500" type="button" @click="orderDialog?.close()">
            ×
          </button>
        </div>
        <div class="mt-5 grid gap-4 sm:grid-cols-2">
          <label class="text-sm font-medium"
            >Покупатель<input
              v-model="orderDraft.customer"
              required
              class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label
          ><label class="text-sm font-medium"
            >Телефон покупателя<input
              v-model="orderDraft.phone"
              required
              class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label
          ><label class="text-sm font-medium"
            >Площадка<select
              v-model="orderDraft.platform"
              class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
              @change="updateDraftPlatform"
            >
              <option v-for="platform in platformOptions" :key="platform" :value="platform">
                {{ platform }}
              </option>
            </select></label
          ><label class="text-sm font-medium"
            >Статус<select
              v-model="orderDraft.status"
              class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
            >
              <option
                v-for="status in statusOptions[orderDraft.platform]"
                :key="status"
                :value="status"
              >
                {{ status }}
              </option>
            </select></label
          >
          <label class="text-sm font-medium"
            >Время заказа<input
              v-model="orderDraft.time"
              class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
              type="time"
          /></label>
        </div>
        <fieldset class="mt-5 rounded-xl border border-slate-200 p-4">
          <legend class="px-2 text-sm font-semibold">Товары в заказе</legend>
          <div
            v-for="product in orderDraft.products"
            :key="product.id"
            class="mt-2 grid gap-2 sm:grid-cols-[1fr_5rem_5rem_4.5rem_5rem_auto]"
          >
            <input
              v-model="product.name"
              required
              class="rounded-lg border border-slate-200 px-2 py-2"
              placeholder="Товар"
            /><input
              v-model="product.size"
              required
              class="rounded-lg border border-slate-200 px-2 py-2"
              placeholder="Размер"
            /><input
              v-model.number="product.price"
              required
              min="0"
              class="rounded-lg border border-slate-200 px-2 py-2"
              type="number"
              placeholder="Цена"
            /><input
              :value="formatOrderNumber(product.costUsd ?? 0)"
              min="0"
              inputmode="decimal"
              class="rounded-lg border border-emerald-100 px-2 py-2"
              type="text"
              placeholder="Себест. $"
              @input="updateDraftUsdCost(product, $event)"
            /><input
              v-model.number="product.cost"
              required
              min="0"
              class="rounded-lg border border-slate-200 px-2 py-2"
              type="number"
              placeholder="Себест. ₴"
              @input="product.costUsd = 0"
            /><button
              class="rounded-lg px-2 text-slate-500 hover:bg-slate-100"
              type="button"
              @click="removeProduct(product.id)"
            >
              ×
            </button>
          </div>
          <button
            class="mt-3 text-sm font-semibold text-emerald-700"
            type="button"
            @click="addProduct"
          >
            + Добавить товар
          </button>
        </fieldset>
        <div class="mt-5 grid gap-4 sm:grid-cols-2">
          <label class="text-sm font-medium"
            >Получатель<input
              v-model="orderDraft.delivery.recipient"
              required
              class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label
          ><label class="text-sm font-medium"
            >Телефон получателя<input
              v-model="orderDraft.delivery.recipientPhone"
              required
              class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label
          ><label class="text-sm font-medium"
            >Перевозчик<select
              v-model="orderDraft.delivery.carrier"
              class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
            >
              <option v-for="carrier in carrierOptions" :key="carrier" :value="carrier">
                {{ carrier }}
              </option>
            </select></label
          ><label class="text-sm font-medium"
            >ТТН<input
              v-model="orderDraft.delivery.ttn"
              class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label
          ><label class="text-sm font-medium"
            >Город<input
              v-model="orderDraft.delivery.city"
              class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label
          ><label class="text-sm font-medium"
            >Отделение / адрес<input
              v-model="orderDraft.delivery.address"
              class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label
          ><label class="text-sm font-medium"
            >Доставка, ₴<input
              v-model.number="orderDraft.shipping"
              min="0"
              class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
              type="number" /></label
          ><label class="text-sm font-medium"
            >Эквайринг, ₴<input
              v-model.number="orderDraft.acquiring"
              min="0"
              class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
              type="number"
          /></label>
        </div>
        <button
          class="mt-6 w-full rounded-xl bg-emerald-700 px-4 py-3 font-semibold text-white hover:bg-emerald-800"
          type="submit"
        >
          Создать заказ
        </button>
      </form>
    </dialog>
  </div>
</template>

<style scoped>
.order-edit .order-cell-edit:not([readonly]) {
  background-color: #fffbeb;
  box-shadow: 0 0 0 2px #fbbf24;
}
</style>
