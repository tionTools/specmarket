export type ReconciliationComparisonInput = {
  accountingUsd: number
  accountingUah: number
  reserveUsd: number
  reserveUah: number
  myDebtUsdAfterAdjustment: number
  myDebtUahAfterAdjustment: number
  usdRate: number
}

export function reconciliationReserveUsd(value: number | null | undefined) {
  return Number(value ?? 0)
}

export function calculateReconciliationComparison(input: ReconciliationComparisonInput) {
  const accountingUsdForComparison = input.accountingUsd - input.reserveUsd
  const accountingUahForComparison = input.accountingUah - input.reserveUah
  const discrepancyUsd = accountingUsdForComparison - input.myDebtUsdAfterAdjustment
  const discrepancyUah = accountingUahForComparison - input.myDebtUahAfterAdjustment

  return {
    accountingUsdForComparison,
    accountingUahForComparison,
    accountingForComparison:
      accountingUsdForComparison * input.usdRate + accountingUahForComparison,
    discrepancyUsd,
    discrepancyUah,
    discrepancyTotalUah: discrepancyUsd * input.usdRate + discrepancyUah,
  }
}
