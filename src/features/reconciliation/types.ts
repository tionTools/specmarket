export type Reconciliation = {
  id: string
  kind: 'initial' | 'reconciliation'
  reconciled_at: string
  usd_rate: number
  accounting_usd: number
  accounting_uah: number
  accounting_total: number
  reserve_uah: number
  crm_balance_usd_before_adjustment: number
  crm_balance_uah_before_adjustment: number
  crm_balance_usd_after_adjustment: number
  crm_balance_uah_after_adjustment: number
  crm_balance_before_adjustment: number
  adjustment_uah: number
  crm_balance_after_adjustment: number
  discrepancy_uah: number
  cost_snapshot_usd: number
  cost_snapshot_uah: number
  created_at: string
}
