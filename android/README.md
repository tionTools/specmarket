# Android CRM — v0.1

Native Android client for the existing CRM backend. The visible app name and main screen title are **«Заказы»**; do not show `SpecMarket` branding in the UI.

## Source of truth

The existing Supabase CRM remains the only source of truth. Android must use the same authenticated Supabase project as the web CRM and must not maintain an independent order database.

Flow:

`Prom / Epicentr / Kasta -> existing Supabase Edge Functions -> crm_orders / crm_order_items -> Web CRM + Android`

Marketplace secrets must never be embedded in the APK. Any marketplace write action goes through an authenticated Supabase Edge Function.

## v0.1 scope

1. Native Kotlin + Jetpack Compose Android project under `android/`.
2. Supabase email/password login using the same account as the web CRM; persist the authenticated session. Guest account is not a writable mobile account.
3. Orders screen:
   - neutral title `Заказы`;
   - pull/explicit refresh;
   - `Новые` and `Все` filters;
   - paged recent history rather than loading the entire table at once;
   - each card shows platform, display/order number, date/time, status, order amount and a short product summary;
   - status color semantics should follow the web CRM: new=blue, active/intermediate=orange/green as appropriate, cancelled/returned=red.
4. Order details:
   - platform, order number, date/time and current status;
   - products with name, size/variant, quantity and price;
   - customer name and phone;
   - delivery carrier, city/address, TTN, payer and seller shipping amount when available;
   - payment method/status when available.
5. Realtime/common state:
   - Android reads the same `crm_orders` and `crm_order_items` as the web CRM;
   - subscribe to relevant Supabase Realtime changes while the app is running;
   - refresh on resume and after write actions;
   - a status change made by the web CRM or another phone must appear without creating a separate mobile copy of the order.
6. Prom acceptance action:
   - for a genuinely new Prom order show a large `Принять` button;
   - first show an Android confirmation dialog containing the order number;
   - after confirmation invoke the authenticated `sync-prom-orders` Edge Function; Android must not call Prom directly;
   - Patch52 extends `sync-prom-orders` with a dedicated `acceptExternalIds` request path that calls Prom `orders/set_status` with status `received` and then updates the CRM order to `Принято` only after Prom succeeds;
   - reject cancelled/returned/completed orders and malformed IDs;
   - repeated/already accepted requests must not regress status;
   - after success refresh the order and remove the `Принять` action.
7. Kasta and Epicentr are read-only in v0.1. Do not fake marketplace acceptance by changing only the local CRM status. Their write API actions will be added only after each API path is verified separately.
8. Settings in v0.1 contain session/account actions only. Per-device push notifications are intentionally **not** implemented in Patch52; FCM/device registration is the next isolated patch so the first APK can be validated before adding another external system.

## Android implementation constraints

- Use a current stable Android toolchain supported by the installed SDK. Baseline verified when this spec was written: AGP 9.4.0, Gradle 9.6.0, Kotlin 2.3.21, Compose BOM 2026.08.00, compileSdk 37, targetSdk 36, minSdk 26, JDK 17.
- Use stable fixed dependency versions; no `+`, `latest.release`, snapshots, alpha/beta dependencies unless a stable compatible version does not exist.
- Prefer the Supabase Kotlin BOM and modules `auth-kt`, `postgrest-kt`, `realtime-kt`, and `functions-kt`, plus a Ktor engine supporting WebSockets. Resolve one stable Supabase/Ktor combination compatible with the chosen Kotlin version and lock it in the project.
- Read the same Supabase URL and publishable key already used by `src/lib/supabase.ts`; these are client/public credentials. Never copy service-role, Prom, Kasta, Epicentr, carrier or other secrets into Android source/build config.
- Keep UI state in a ViewModel/repository layer; Compose screens must not contain networking code.
- Represent Supabase rows with explicit serializable data classes. Keep unknown/optional `delivery` JSON fields tolerant so a new backend field does not crash old APKs.
- Do not log passwords, access tokens, customer phone numbers, addresses or full order payloads.

## Minimum Android tests

Unit-test pure logic for:

- normalized `Новый` detection across actual CRM status spellings;
- status tone/color mapping including cancelled/returned red;
- order total calculation from items;
- Prom `Принять` button eligibility (Prom + new only; no cancelled/returned/completed/already accepted status).

## Backend tests

Extract pure Prom mobile/order-action eligibility/ID normalization logic from `sync-prom-orders` into a small `_shared` helper and cover it with Deno tests. Existing completion (`completeExternalIds`) behavior must remain unchanged.

## Build and artifact

Commit a Gradle wrapper under `android/`. Add a GitHub Actions workflow that can be triggered manually and on Android-source changes, runs Android unit tests/lint/build and uploads an installable debug APK artifact. Local Codex validation must also run the Gradle build when the Android SDK is available.

## Explicit non-goals for Patch52

- no Firebase/FCM yet;
- no per-device notification switch yet;
- no direct marketplace tokens in Android;
- no Android editing of finance/reconciliation/Excel/cost-price features;
- no Kasta/Epicentr write action until their API endpoints and transition rules are verified;
- do not change existing web CRM behavior except the additive authenticated Prom `acceptExternalIds` backend capability required by Android.
