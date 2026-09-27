# Marketplace pause — release and verification

The three switches in Settings control **CRM marketplace order import**, not external product
publication. Disabled price columns are hidden in the CRM, not deleted or replaced with zeros.
Existing orders and tracking remain available; delivery tracking runs independently.

## Mandatory release order

1. Apply migration `20260927213000_marketplace_pause.sql` and register it as applied.
   It defaults Prom, Epicentr and Kasta to **enabled**; it does not pause any marketplace.
2. Verify `public.crm_marketplace_settings` has three rows and each value is true.
   Verify authenticated read/non-guest update, guest read-only, no anon access; the new
   secret-returning RPC must be executable by `service_role` only, not by `authenticated`.
3. Deploy the three Edge Functions: `sync-prom-orders`, `sync-epicentr-orders`, `sync-kasta-orders`.
   **Do not deploy these functions before the migration.** A missing RPC deliberately blocks imports.
4. Merge the frontend change and deploy the browser app. The existing GitHub main workflow
   deploys the browser app; it does not apply migrations or deploy Edge Functions.

## SQL verification (safe: transaction rolls back)

```sql
select platform, enabled from public.crm_marketplace_settings order by platform;

begin;
update public.crm_marketplace_settings set enabled = false where platform = 'Каста';

select
  public.crm_marketplace_sync_is_due('Каста', '2026-09-27 10:02:00+03'::timestamptz)
    as kasta_paused_must_be_false,
  public.crm_marketplace_sync_is_due('Пром', '2026-09-27 10:00:00+03'::timestamptz)
    as prom_still_due;
rollback;

select platform, enabled from public.crm_marketplace_settings order by platform;
```

Expected inside the transaction: `kasta_paused_must_be_false = false`,
`prom_still_due = true`. All three switches should still be true after rollback.

## Functional verification

- Pause Kasta in browser Settings. The price table hides all three Kasta columns but retains
  their database values. Prom/Epicentr columns remain. A second browser sees the same switch.
- For the next scheduled Kasta poll, `crm_marketplace_sync_is_due('Каста')` is false:
  no `sync-kasta-orders` Edge invocation, no Kasta external API polling, no Kasta
  price/currency reference reads. Cron polling itself remains scheduled and inexpensive.
- A direct manual Kasta import returns HTTP 409 `MARKETPLACE_PAUSED`; a service
  cron-authorized invocation returns a success `skipped: paused`. Unauthenticated and
  guest calls remain rejected.
- A failed settings lookup returns 503 and does not proceed to the marketplace.
- With Kasta enabled but no changed orders or within the two-minute cooldown,
  price links and currency-rate tables are **not** read by Kasta. When changed orders
  exist, they are loaded once per invocation even across pages.
- Re-enable Kasta and verify that its next due poll runs; old price values reappear.
  Existing orders and separate carrier tracking are unaffected.
- Repeat the pause/resume smoke test for Prom and Epicentr. Do not change their cron
  schedules or existing order state.

A poll already in flight may finish after switching off; new imports are guarded both
in PostgreSQL and in the Edge Function. The pause does not remove products from a
marketplace or turn their listed prices to zero. If the seller is disconnected, any
marketplace account changes must be handled at the marketplace itself.

Run scoped formatter, `pnpm type-check`, `pnpm lint`, `pnpm build`, relevant Deno
tests, Deno checks, `git diff --check`, and review the real diff before merging.
Do not claim quota savings without a comparable Logs Ingest before/after measurement.
