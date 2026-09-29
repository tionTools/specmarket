# Patch 165 — final accounting history seal

## Status

PREPARED ONLY. Do not apply, merge, deploy, or activate while the user is still accepting returns / reconciling.

Reviewed against main:
`1d5c30e3a95fa7fa4d437453d2fa6a11717ae0d5`

Current main includes the return-arrived fix:
- transport state `trackingReturnArrived`;
- a delivered return remains visible in the Returns filter;
- transport arrival does not create an accounting return;
- accounting return still exists only through manual `crm_order_item_returns`.

Before eventual release, rebase again on the then-current main and re-read the latest definition of `get_crm_current_cost_totals()`.

## Known repository migration baseline

A full `supabase db reset` is currently NOT a valid acceptance gate for Patch 165.

Verified repository history:
- commit `0e36db95d6df3633615cc2f3c90ab8fc6fb51146` started using `crm_orders` / `crm_order_items` through Supabase;
- no versioned migration in repository history creates those two base tables;
- the first current migrations already ALTER them;
- therefore a clean reset fails before Patch 165 at `20260808_epicentr_customer_details.sql` with `relation "public.crm_orders" does not exist`.

This is pre-existing migration-history debt, not a Patch 165 failure. Do not add or guess a production baseline schema inside Patch 165 and do not expand this PR to repair all historical migrations.

## Goal

After the user's final reconciliation, create one durable accounting boundary:

- everything already included in the reconciliation is frozen as the historical supplier-cost baseline;
- historical zero-contribution cancelled/deleted/returned shipment records are also frozen at zero so a later stale status/TTN refresh cannot resurrect old supplier debt;
- genuinely future active orders that have not yet entered any shipment/return lifecycle stay live and can affect debt later;
- a genuine manually accepted return after the boundary can still reduce supplier debt;
- transport-only `trackingReturnArrived` must never reduce supplier debt by itself.

This is an accounting seal, not an operational order lock. Old orders may still receive marketplace/tracking updates; those updates just must not rewrite the reconciled accounting baseline.

## Source-of-truth production rule

At review time the latest production definition of `get_crm_current_cost_totals()` comes from:

`supabase/migrations/20260928125000_carrier_deleted_ttn_accounting.sql`

Patch 165 MUST preserve all of that rule before the seal, including:

- non-empty TTN requirement;
- `trackingNormalizedStatus <> 'deleted'`;
- cancelled/returned-without-physical-movement exclusion;
- manual accepted returns through `crm_order_item_returns.returned_quantity`.

Do not copy an older formula such as the pre-`carrier_deleted_ttn_accounting` version.

At release time Codex must locate the latest definition again. If main has changed the cost-basis rule, Patch 165 must be updated to that latest rule before any migration is applied.

## Data model

Patch 165 uses three protected snapshot tables:

- `crm_accounting_history_lock`: one seal header tied to the final reconciliation;
- `crm_accounting_history_lock_orders`: every order whose shipment/return history is already historical at the seal, plus whether it contributed to supplier debt at the seal;
- `crm_accounting_history_lock_items`: immutable item quantity/cost/accepted-return baseline for those locked orders.

All new public tables:
- explicit least-privilege GRANTs in the migration;
- RLS enabled;
- read policy only for `service_role`;
- no `anon` or `authenticated` table access.

Activation function `seal_crm_accounting_history()`:
- SECURITY DEFINER;
- EXECUTE only for `service_role`;
- one-time;
- same-reconciliation retry is idempotent;
- a later different reconciliation must not silently replace the original final seal.

## Which orders become historical

At seal time lock an order if it has already entered shipment/return history, including any of:

- current TTN;
- `printedAt`;
- physical tracking status: accepted / in_transit / ready_for_pickup / delivered / returning / returned;
- carrier-deleted state;
- `trackingReturnInProgress`;
- `trackingReturnArrived`;
- non-empty `shipmentHistory`;
- marketplace/order status signalling cancellation or return.

This deliberately locks deleted/cancelled historical orders even when their contribution at the seal is zero.

Do NOT lock a clean active order that has:
- no TTN;
- no print;
- no shipment history;
- no physical/return/deleted tracking state;
- no cancellation/return signal.

Such an order is future business, not historical accounting, and may later enter supplier debt normally.

Once an order is locked, later-added/reordered items on that same historical order must not become live accounting merely because their item position did not exist at the seal. Locking is order-level; item snapshots provide the frozen values.

## Accounting after the seal

For a locked order:

- `included_at_seal=true`: use frozen quantity, frozen cost and frozen accepted-return quantity as baseline;
- `included_at_seal=false`: contribution remains zero even if stale status/TTN/tracking later changes;
- later changes to order status, TTN, tracking, current item quantity or current item cost cannot rewrite the baseline;
- later-added item rows on the locked order cannot create new historical cost.

A later manually accepted return may reduce a locked positive baseline only by the quantity above `returned_quantity_at_seal`, and only when:
- `returned_at` is after the reconciliation date; or
- it is the same Kyiv calendar date and the row was updated after `sealed_at`.

A return entered after the seal but backdated before the boundary is historical and must not rewrite the baseline.

Reducing/deleting a return below the quantity already frozen at the seal must not resurrect old historical supplier debt.

For an order not locked at the seal, the normal current production rule remains live.

## Return-arrived regression requirements

The return-arrived fix on current main must remain semantically separate from accounting:

1. ordinary buyer `delivered` stays ordinary delivery;
2. return TTN `delivered` may set `trackingReturnArrived=true`;
3. `trackingReturnArrived` alone does not alter `get_crm_current_cost_totals()`;
4. no `crm_order_item_returns` row is created automatically;
5. only manual accepted return quantity changes supplier debt;
6. a return already accepted before the final reconciliation is part of the frozen baseline;
7. a genuine manual return accepted after the seal can reduce the frozen baseline.

## Seal safety checks

`seal_crm_accounting_history()` must:

1. take the latest `kind='reconciliation'`;
2. hold a short consistent lock against concurrent order/item/return writes;
3. recompute current cost totals with the exact current production rule;
4. abort if USD or UAH differs from the reconciliation `cost_snapshot_usd/cost_snapshot_uah`;
5. create the historical order/item snapshot;
6. independently sum the frozen included snapshot;
7. abort and roll back if the frozen sum differs from the reconciliation snapshot;
8. return reconciliation ID, seal timestamp, order count, item count, USD and UAH.

Never repair a mismatch by editing reconciliation snapshots or historical orders.

## Scope

Only:

- `supabase/migrations/20260929120000_accounting_history_seal.sql`
- `scripts/patch-165-accounting-history-seal.md`

No frontend changes.
No tracking Function changes.
No marketplace sync changes.
No Prices changes.
No registry/payment changes.
No Android changes.
No schedule changes.

If a later main change makes an additional file genuinely necessary, STOP and report why instead of silently expanding scope.

## Verification before release

Codex must not treat this spec as permission to release yet.

When the user explicitly says the returns and final reconciliation are complete:

1. Fetch current main and compare with this branch.
2. Rebase Patch 165 on current main.
3. Inspect all migrations after `20260928125000_carrier_deleted_ttn_accounting.sql` for any newer definition of `get_crm_current_cost_totals()`.
4. If newer production migrations exist, rename Patch 165 migration timestamp so it sorts after every already-applied migration.
5. Exact diff: only the two allowed files.
6. Do NOT require `supabase db reset`; it is blocked by the verified pre-existing missing base migration described above.
7. Verify new table GRANT/RLS/policies and service-role-only seal EXECUTE.
8. Run an isolated PostgreSQL/Supabase SQL logic harness. The harness is test-only and must not be committed to PR #29. It may define only the minimal current columns/types required by Patch 165, using types supported by versioned migrations/current SQL:
   - `crm_orders.id uuid`, `status text`, `delivery jsonb`;
   - `crm_order_items.order_id uuid`, `position integer`, `product_name text`, `quantity integer/numeric`, `cost numeric`, `cost_usd numeric`;
   - exact current versioned columns needed from `crm_reconciliations` and `crm_order_item_returns`.
   The harness must install the exact pre-patch `get_crm_current_cost_totals()` from the latest production migration, seed fixtures, record pre-patch totals, apply Patch 165 SQL, and prove that before seal totals are unchanged. This is a unit/integration test of Patch 165 SQL logic; do not claim it repairs or reproduces the whole project migration chain.
9. Before production migration, run read-only metadata preflight against the linked production DB and record:
   - actual column types used by Patch 165 from `information_schema.columns`;
   - actual current `pg_get_functiondef('public.get_crm_current_cost_totals()'::regprocedure)`;
   - latest reconciliation ID/timestamps/cost snapshots;
   - current `get_crm_current_cost_totals()`.
   If types or function semantics differ from the reviewed assumptions, STOP before applying anything.
10. Regression cases must PASS:
   - carrier-deleted TTN remains excluded;
   - ordinary delivered order stays accounted normally;
   - delivered return with `trackingReturnArrived` changes no accounting until manual return;
   - already accepted pre-seal return is baseline;
   - post-seal genuine manual return reduces baseline;
   - backdated pre-boundary return does not rewrite baseline;
   - reducing a pre-seal return cannot resurrect cost;
   - locked included order ignores later cost/quantity/status/TTN changes;
   - locked zero deleted/cancelled order cannot later resurrect cost;
   - later-added item on locked historical order cannot create cost;
   - clean active no-shipment order left unlocked can later acquire TTN and enter accounting normally.
11. `git diff --check`.
12. Relevant SQL/static checks only; no unrelated formatter churn.

## Production rollout — only after explicit approval

1. Record current main SHA and latest applied migration.
2. Run the read-only production metadata/type/function preflight required above.
3. Read latest reconciliation ID, `created_at`, `reconciled_at`, `cost_snapshot_usd`, `cost_snapshot_uah`.
4. Read current `get_crm_current_cost_totals()`.
5. If either currency differs from the reconciliation snapshot: STOP. Do not apply/activate.
6. Apply Patch 165 migration.
7. Before seal, call `get_crm_current_cost_totals()` again and prove migration alone changed nothing.
8. Call `seal_crm_accounting_history()` exactly once.
9. Record its reconciliation ID, seal timestamp, locked order count, item count, USD and UAH.
10. Immediately read current totals again; seal itself must change nothing.
11. Verify one lock header and matching order/item snapshots.
12. Only then merge PR and wait Production Deploy SUCCESS.
13. Return exact merge SHA, migration status, seal result and before/after totals.

## Stop conditions

Stop without seal/merge if:

- current main contains a newer supplier-cost rule not incorporated into Patch 165;
- latest reconciliation is missing;
- current totals differ from its snapshots;
- migration ordering is stale;
- any deleted-TTN regression appears;
- `trackingReturnArrived` affects accounting without a manual return;
- historical zero orders can resurrect cost;
- clean future orders are accidentally frozen;
- any required fix would expand beyond the two-file scope.

Do not improvise around a failed invariant.
