from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, got {count}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


view = "src/pages/ReconciliationView.vue"

replace_once(
    view,
    "const reserveUah = ref('')\nconst adjustmentUah = ref('')",
    "const reserveUah = ref('')\nconst adjustmentUsd = ref('')\nconst adjustmentUah = ref('')",
)

replace_once(
    view,
    """watch([paymentTransferredUah, paymentSupplierRate, paymentDebtUsd], () => {
  const remainder = suggestedPaymentDebtUah()
  paymentDebtUah.value =
    remainder === null ? '' : String(Number(remainder.toFixed(2))).replace('.', ',')
})
""",
    """watch([paymentTransferredUah, paymentSupplierRate, paymentDebtUsd], () => {
  const remainder = suggestedPaymentDebtUah()
  paymentDebtUah.value =
    remainder === null ? '' : String(Number(remainder.toFixed(2))).replace('.', ',')
})

watch([adjustmentUsd, usdRate], () => {
  if (!adjustmentUsd.value.trim()) return
  const usd = parsedNumber(adjustmentUsd.value)
  if (usd === null || usdRate.value <= 0) return
  adjustmentUah.value = String(Number((-usd * usdRate.value).toFixed(2))).replace('.', ',')
})
""",
)

replace_once(
    view,
    """const accountingForComparison = computed(
  () => accountingTotal.value - numberValue(reserveUah.value),
)
const myNumberAfterAdjustment = computed(() => myNumber.value + numberValue(adjustmentUah.value))
""",
    """const accountingForComparison = computed(
  () => accountingTotal.value - numberValue(reserveUah.value),
)
const myDebtUsdAfterAdjustment = computed(
  () => myDebtUsd.value + numberValue(adjustmentUsd.value),
)
const myDebtUahAfterAdjustment = computed(
  () => myDebtUah.value + numberValue(adjustmentUah.value),
)
const myNumberAfterAdjustment = computed(
  () => myDebtUsdAfterAdjustment.value * usdRate.value + myDebtUahAfterAdjustment.value,
)
""",
)

replace_once(
    view,
    """const discrepancy = computed(() =>
  hasAccountingInput.value ? accountingForComparison.value - myNumberAfterAdjustment.value : null,
)
const history = computed(() => reconciliations.value)
""",
    """const discrepancyUsd = computed(() =>
  hasAccountingInput.value
    ? numberValue(accountingUsd.value) - myDebtUsdAfterAdjustment.value
    : null,
)
const discrepancyUah = computed(() =>
  hasAccountingInput.value
    ? numberValue(accountingUah.value) - numberValue(reserveUah.value) - myDebtUahAfterAdjustment.value
    : null,
)
const discrepancy = computed(() =>
  discrepancyUsd.value === null || discrepancyUah.value === null
    ? null
    : discrepancyUsd.value * usdRate.value + discrepancyUah.value,
)
const history = computed(() => reconciliations.value)
""",
)

replace_once(
    view,
    """  const reserveValue = reserveUah.value.trim() ? parsedNumber(reserveUah.value) : 0
  const adjustmentValue = adjustmentUah.value.trim() ? parsedNumber(adjustmentUah.value) : 0
  if (
    accountingUsdValue === null ||
    accountingUahValue === null ||
    reserveValue === null ||
    adjustmentValue === null ||
""",
    """  const reserveValue = reserveUah.value.trim() ? parsedNumber(reserveUah.value) : 0
  const adjustmentUsdValue = adjustmentUsd.value.trim() ? parsedNumber(adjustmentUsd.value) : 0
  const adjustmentUahValue = adjustmentUah.value.trim() ? parsedNumber(adjustmentUah.value) : 0
  if (
    accountingUsdValue === null ||
    accountingUahValue === null ||
    reserveValue === null ||
    adjustmentUsdValue === null ||
    adjustmentUahValue === null ||
""",
)

replace_once(
    view,
    """    crm_balance_before_adjustment: myNumber.value,
    adjustment_uah: adjustmentValue,
    crm_balance_after_adjustment: myNumberAfterAdjustment.value,
    crm_balance_usd_before_adjustment: myDebtUsd.value,
    crm_balance_uah_before_adjustment: myDebtUah.value,
    crm_balance_usd_after_adjustment: myDebtUsd.value,
    crm_balance_uah_after_adjustment: myDebtUah.value + adjustmentValue,
""",
    """    crm_balance_before_adjustment: myNumber.value,
    adjustment_usd: adjustmentUsdValue,
    adjustment_uah: adjustmentUahValue,
    crm_balance_after_adjustment: myNumberAfterAdjustment.value,
    crm_balance_usd_before_adjustment: myDebtUsd.value,
    crm_balance_uah_before_adjustment: myDebtUah.value,
    crm_balance_usd_after_adjustment: myDebtUsdAfterAdjustment.value,
    crm_balance_uah_after_adjustment: myDebtUahAfterAdjustment.value,
""",
)

replace_once(
    view,
    """  reserveUah.value = ''
  adjustmentUah.value = ''
""",
    """  reserveUah.value = ''
  adjustmentUsd.value = ''
  adjustmentUah.value = ''
""",
)

replace_once(
    view,
    """                <label class="text-sm font-medium text-slate-600"
                  >Сторно<input
                    v-model="adjustmentUah"
                    :disabled="isGuest"
                    class="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"
                    inputmode="decimal"
                    placeholder="+/- 0,00"
                    @keydown.enter.prevent="adjustmentUah = committedNumericValue(adjustmentUah)"
                /></label>
""",
    "",
)

replace_once(
    view,
    """                <label class="text-sm font-medium text-slate-600"
                  >Доллары 1С<input
                    v-model="accountingUsd"
                    :disabled="isGuest"
                    class="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"
                    inputmode="decimal"
                    placeholder="0,00"
                    @keydown.enter.prevent="accountingUsd = committedNumericValue(accountingUsd)"
                /></label>
""",
    """                <label class="text-sm font-medium text-slate-600"
                  >Доллары 1С<input
                    v-model="accountingUsd"
                    :disabled="isGuest"
                    class="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"
                    inputmode="decimal"
                    placeholder="0,00"
                    @keydown.enter.prevent="accountingUsd = committedNumericValue(accountingUsd)"
                /></label>
                <label class="text-sm font-medium text-slate-600"
                  >Сторно USD<input
                    v-model="adjustmentUsd"
                    :disabled="isGuest"
                    class="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"
                    inputmode="decimal"
                    placeholder="+/- 0,00"
                    @keydown.enter.prevent="adjustmentUsd = committedNumericValue(adjustmentUsd)"
                /></label>
                <label class="text-sm font-medium text-slate-600"
                  >USD после сторно<input
                    :value="money(myDebtUsdAfterAdjustment)"
                    readonly
                    class="mt-1 block w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 font-semibold text-slate-700"
                /></label>
""",
)

replace_once(
    view,
    """                <label class="text-sm font-medium text-slate-600"
                  >Гривна 1С<input
                    v-model="accountingUah"
                    :disabled="isGuest"
                    class="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"
                    inputmode="decimal"
                    placeholder="0,00"
                    @keydown.enter.prevent="accountingUah = committedNumericValue(accountingUah)"
                /></label>
""",
    """                <label class="text-sm font-medium text-slate-600"
                  >Гривна 1С<input
                    v-model="accountingUah"
                    :disabled="isGuest"
                    class="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"
                    inputmode="decimal"
                    placeholder="0,00"
                    @keydown.enter.prevent="accountingUah = committedNumericValue(accountingUah)"
                /></label>
                <label class="text-sm font-medium text-slate-600"
                  >Сторно грн<input
                    v-model="adjustmentUah"
                    :disabled="isGuest"
                    class="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"
                    inputmode="decimal"
                    placeholder="+/- 0,00"
                    @keydown.enter.prevent="adjustmentUah = committedNumericValue(adjustmentUah)"
                /></label>
                <label class="text-sm font-medium text-slate-600"
                  >Гривна после сторно<input
                    :value="money(myDebtUahAfterAdjustment)"
                    readonly
                    class="mt-1 block w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 font-semibold text-slate-700"
                /></label>
""",
)

replace_once(
    view,
    """              <strong v-if="hasAccountingInput"
                >Не сходится: {{ money(discrepancy ?? 0) }} грн</strong
              >
""",
    """              <strong v-if="hasAccountingInput"
                >Не сходится: USD {{ money(discrepancyUsd ?? 0) }} · грн
                {{ money(discrepancyUah ?? 0) }} · итого {{ money(discrepancy ?? 0) }} грн</strong
              >
""",
)

replace_once(
    "src/features/reconciliation/types.ts",
    "  crm_balance_before_adjustment: number\n  adjustment_uah: number",
    "  crm_balance_before_adjustment: number\n  adjustment_usd: number\n  adjustment_uah: number",
)

history = "src/features/reconciliation/ReconciliationHistoryTable.vue"
replace_once(
    history,
    """    {
      id: 'adjustment',
      header: 'Сторно',
      cell: valueCell((item) =>
        item.kind === 'initial' ? '—' : props.money(Number(item.adjustment_uah)),
      ),
    },
""",
    """    {
      id: 'adjustmentUsd',
      header: 'Сторно USD',
      cell: valueCell((item) =>
        item.kind === 'initial' ? '—' : props.money(Number(item.adjustment_usd ?? 0)),
      ),
    },
    {
      id: 'adjustmentUah',
      header: 'Сторно грн',
      cell: valueCell((item) =>
        item.kind === 'initial' ? '—' : props.money(Number(item.adjustment_uah)),
      ),
    },
""",
)
replace_once(
    history,
    '<table class="w-full min-w-[72rem] text-left text-sm">',
    '<table class="w-full min-w-[78rem] text-left text-sm">',
)

Path("supabase/migrations/20260912100000_reconciliation_usd_adjustment.sql").write_text(
    "alter table public.crm_reconciliations\n"
    "  add column if not exists adjustment_usd numeric not null default 0;\n",
    encoding="utf-8",
)
