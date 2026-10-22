# Prom / Epicentr: order composition validation

Base: `2e2963b6270b3ae625f73b49b0ca234fdcadfeff` (remote main checked before implementation).

## Scope

Reject absent, non-array, empty or malformed composition before writing the affected
order header, items or sync state. Require a nonempty name, positive finite quantity,
and nonnegative finite unit price (or a valid line total divided by quantity).
Explicit zero price is valid. Malformed fields are not replaced with defaults and
invalid lines are not filtered out of a replacement composition.

The error response is HTTP 502 with `ok: false`, `code: INVALID_ORDER_ITEMS`, an
order `externalId` when known, and a field/position diagnostic without product data.
Missing list envelopes and invalid JSON are also errors. Empty _order lists_ remain valid.

Prom validates the received importable orders before hash filtering and writes.
An invalid order stops that batch before order writes. Epicentr validates each detail
response before writing that order; already completed orders remain saved if a later
order fails. Epicentr list metadata is still used for category lookup, but cannot fill
in a missing detail composition. Category lookup metadata is outside the order transaction.

## API contract review — 21 October 2026

- [Prom list](https://public-api.docs.prom.ua/documentation/Orders/paths/GetOrderList.yaml)
  and [Prom detail](https://public-api.docs.prom.ua/documentation/Orders/paths/GetOrder.yaml)
  both reference the same [Order schema](https://public-api.docs.prom.ua/documentation/Orders/schemas/Order.yaml).
  Its `products` array references [Product](https://public-api.docs.prom.ua/documentation/Orders/schemas/Product.yaml):
  `name`, numeric `quantity`, string unit `price`, and string `total_price`.
  The list limit applies to orders, not documented product pages.
- [Epicentr Swagger](https://merchant-api.epicentrm.com.ua/swagger/swagger.yaml):
  `GET /v6/oms/orders/{orderId}` returns `OrderModel`, with required `items`.
  `OrderProductModel` requires `title`, `quantity`, and `price` among other fields.
  `_enables[]=products` adds product models; it is not a composition-completeness flag.

Neither inspected contract supplies a line count, completeness marker or other
independent proof that a syntactically valid nonempty array contains every line.
They describe an order snapshot, but cannot detect silent upstream truncation.

**STOP for the unproven scenario:** `[A, B] -> [A]` may be either a legitimate deletion
or a silently incomplete response. This patch does not distinguish those cases and
does not claim protection against all partial responses. It preserves the existing
replacement behavior for structurally valid nonempty snapshots; it adds no
"fewer rows means invalid" rule. Do not approve production rollout as a complete fix
for silent truncation without a provider guarantee or an independently verifiable
completeness contract. No merge or deployment is included.

## Verification

`node --test supabase/functions/_shared/marketplace-order-items_test.mjs`
runs the actual handlers and local helpers with in-memory API/DB boundaries.
There is no production access. Both targeted and scheduled requests cover import,
quantity/price updates, addition, deletion from a fixture explicitly defined as complete,
zero and derived prices, malformed/missing/empty composition, invalid JSON, and repeat
responses. Error cases assert no writes to the affected order tables and preserve
the full stored snapshot, including manual costs and commissions.

The deletion fixture establishes expected behavior for a known complete input; it
does **not** prove that a live API response is complete. The DB mock checks handler
calls and snapshots, not PostgreSQL transaction/locking behavior. Concurrency,
product identity, returns, pagination, financial rules, SQL and cron are unchanged.

Other required checks: project `pnpm type-check`, Deno checks of both handlers,
targeted lint, formatting of changed code, and `git diff --check`.

Results: 19 named tests passed (including per-field cases for both request modes).
`pnpm type-check`, `deno check --no-lock` for both handlers, targeted ESLint and oxlint,
and `pnpm build` passed. Build reports the existing bundle-size warning. New files
were formatted with oxfmt; existing handlers retain unrelated formatting.
No SQL changes, production requests, merge or deployment were performed.
