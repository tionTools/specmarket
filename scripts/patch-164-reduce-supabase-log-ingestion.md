# Patch 164 — Reduce Supabase log ingestion

## Цель

Снизить Supabase Logs Ingest по двум источникам, подтверждённым выгрузкой за 28.09.2026 22:05–23:55 Europe/Kyiv, без изменения рабочей частоты синхронизации маркетплейсов и без изменения логики цен/доставочного tracking.

Наблюдение в выгрузке:
- 338 `/realtime/v1/websocket`, из них 336 от Android `ktor-client`;
- 46 GET `crm_deleted_marketplace_orders`;
- 46 GET `crm_marketplace_order_sync_state`;
- 46 POST `crm_marketplace_order_sync_state`.

## Зафиксированная реализация

### Android

- Версия: 0.23 / versionCode 23.
- Supabase Realtime используется только пока UI приложения находится в foreground.
- При `ON_PAUSE` активный Realtime job отменяется.
- При возвращении приложения в foreground Realtime запускается снова и выполняется обычный refresh.
- В фоне новые заказы продолжают доставляться через уже существующий FCM path.
- Не менять FCM registration, push payload, notification dedupe или серверный push trigger.

### Marketplace sync

Для Prom, Epicentr и Kasta:

- два отдельных REST GET:
  - `crm_deleted_marketplace_orders`;
  - `crm_marketplace_order_sync_state`;
  заменить одним service-role RPC:
  `get_crm_marketplace_order_sync_context(text, text[])`.
- RPC возвращает для каждого requested external_id:
  - `external_id`;
  - `is_deleted`;
  - `source_hash`;
  - `order_id`;
  - `synced_at`.
- RPC недоступен `public`, `anon`, `authenticated`; EXECUTE только `service_role`.
- RLS/права существующих таблиц не менять.
- Запись `crm_marketplace_order_sync_state` оставить по одному успешно обработанному заказу. Не переносить её в общий batch в конце цикла: при ошибке на более позднем заказе уже успешно обработанные заказы должны сохранить state.

## Нельзя менять

- 5-минутную частоту Prom/Epicentr/Kasta.
- day/night offsets и `crm_marketplace_sync_is_due`.
- Epicentr TTL refresh semantics.
- Marketplace API endpoints/actions.
- pause semantics.
- `crm_price_items` / PricesView.
- delivery tracking schedule/worker.
- NovaPay/Monobank.
- логику финансов, реестров, себестоимости и возвратов.
- frontend web CRM.

## Изменённый scope

Разрешены только:
- `android/README.md`
- `android/app/build.gradle.kts`
- `android/app/src/main/java/ua/orders/crm/OrdersViewModel.kt`
- `supabase/functions/_shared/marketplace-order-sync-context.ts`
- `supabase/functions/_shared/marketplace-order-sync-context_test.ts`
- `supabase/functions/sync-prom-orders/index.ts`
- `supabase/functions/sync-epicentr-orders/index.ts`
- `supabase/functions/sync-kasta-orders/index.ts`
- `supabase/migrations/20260928212000_marketplace_sync_context_batch.sql`
- этот файл спецификации.

Любое изменение вне этого списка запрещено без отдельного согласования.

## Проверки Codex

Codex не проектирует альтернативное решение и не расширяет scope. Его роль: проверить готовый Patch 164, при необходимости сообщить о фактическом дефекте, затем выполнить rollout.

Обязательно:

1. Проверить реальный diff и отсутствие formatter churn.
2. Deno test:
   - `supabase/functions/_shared/marketplace-order-sync-context_test.ts`;
   - существующие marketplace-related tests.
3. Deno check:
   - Prom;
   - Epicentr;
   - Kasta.
4. Android:
   - unit tests;
   - lint;
   - release/debug assembly в зависимости от доступного signing/SDK;
   - подтвердить foreground Realtime;
   - подтвердить прекращение Realtime в background;
   - подтвердить неизменность FCM path.
5. SQL:
   - синтаксис миграции;
   - одна строка на unique requested external_id;
   - tombstone + nullable state;
   - EXECUTE только service_role.
6. Подтвердить, что в каждой из трёх Edge Functions старые два REST GET отсутствуют и используется один context RPC.
7. Подтвердить сохранение per-order sync-state upsert.
8. `git diff --check`.
9. Scoped Oxlint/ESLint.
10. `pnpm type-check`.
11. `pnpm build`.

## Stop conditions

Если обнаружен новый FAIL в изменённом коде:
- не придумывать другую архитектуру;
- не расширять scope;
- не чинить несвязанные baseline-проблемы;
- остановиться и сообщить точный FAIL, файл/строку и минимально необходимое исправление.

Известные baseline-проблемы вне scope не должны блокировать rollout, если они не вызваны Patch 164.

## Rollout

Только после PASS проверок:

1. Применить миграцию `20260928212000_marketplace_sync_context_batch.sql`.
2. Проверить наличие RPC и grants в production.
3. Deploy:
   - `sync-prom-orders`;
   - `sync-epicentr-orders`;
   - `sync-kasta-orders`.
4. Smoke-check без изменения production-заказов сверх обычной синхронизации.
5. Merge PR #28.
6. Дождаться `Deploy to Production` SUCCESS на merge SHA.
7. Дождаться Android APK workflow SUCCESS и публикации v0.23.
8. В отчёте вернуть: merge SHA, migration status, Edge deploy status, Production Deploy run, Android APK run/version и все проверки.
