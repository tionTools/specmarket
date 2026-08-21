update public.crm_reconciliations
set usd_rate = (crm_balance_after_adjustment - crm_balance_uah_after_adjustment) /
  nullif(crm_balance_usd_after_adjustment, 0)
where kind = 'initial'
  and usd_rate = 0
  and crm_balance_usd_after_adjustment <> 0
  and adjustment_uah = 0
  and crm_balance_before_adjustment = crm_balance_after_adjustment
  and crm_balance_uah_before_adjustment = crm_balance_uah_after_adjustment;
