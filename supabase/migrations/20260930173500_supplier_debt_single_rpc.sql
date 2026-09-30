create or replace function public.get_crm_supplier_debt_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with checkpoint as (
    select
      r.created_at,
      r.crm_balance_usd_after_adjustment,
      r.crm_balance_uah_after_adjustment,
      r.cost_snapshot_usd,
      r.cost_snapshot_uah
    from public.crm_reconciliations r
    where r.kind in ('reconciliation', 'initial')
    order by
      case when r.kind = 'reconciliation' then 0 else 1 end,
      r.created_at desc
    limit 1
  ),
  current_rate as (
    select rates.rate
    from public.crm_currency_rates rates
    where rates.currency = 'USD'
      and rates.effective_from <= (pg_catalog.now() at time zone 'Europe/Kyiv')::date
      and rates.rate > 0
    order by rates.effective_from desc
    limit 1
  ),
  paid_debt as (
    select
      coalesce(sum(payments.debt_usd), 0) as usd,
      coalesce(sum(payments.debt_uah), 0) as uah
    from checkpoint
    left join public.crm_supplier_payments payments
      on payments.created_at > checkpoint.created_at
  ),
  current_costs as (
    select public.get_crm_current_cost_totals() as totals
  ),
  debt as (
    select
      checkpoint.crm_balance_usd_after_adjustment
        + (
          coalesce((current_costs.totals ->> 'usd')::numeric, 0)
          - checkpoint.cost_snapshot_usd
        )
        - paid_debt.usd as usd,
      checkpoint.crm_balance_uah_after_adjustment
        + (
          coalesce((current_costs.totals ->> 'uah')::numeric, 0)
          - checkpoint.cost_snapshot_uah
        )
        - paid_debt.uah as uah,
      current_rate.rate as usd_rate
    from checkpoint
    cross join current_rate
    cross join paid_debt
    cross join current_costs
  )
  select jsonb_build_object(
    'usdRate', debt.usd_rate,
    'debtUsd', debt.usd,
    'debtUah', debt.uah,
    'supplierDebtUah', debt.usd * debt.usd_rate + debt.uah
  )
  from debt;
$$;

revoke all on function public.get_crm_supplier_debt_snapshot()
from public, anon;
grant execute on function public.get_crm_supplier_debt_snapshot()
to authenticated;
