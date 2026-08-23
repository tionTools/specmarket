# sync-delivery-tracking

## Назначение

`sync-delivery-tracking` отвечает только за получение фактической информации о существующих доставках.

## Архитектура

```text
index.ts
  ↓
worker.ts
  ↓
carrier-detection.ts
  ↓
carriers/<carrier>.ts
  ↓
normalized TrackingResult
  ↓
storage.ts
```

Общие типы находятся в `types.ts`, общие функции нормализации — в `normalize.ts`.

## Перевозчики

```text
Nova Poshta      → официальный API
Укрпошта         → официальный API
Meest            → официальный API
Rozetka Delivery → существующий public tracking
```

## Не менять без отдельной задачи

- marketplace sync;
- создание заказов;
- создание ТТН;
- `crm_orders.status`;
- frontend CRM;
- механизм Rozetka Delivery;
- cron/security configuration.

## Secrets

Используются существующие secrets. Не хранить и не логировать их значения:

- `NOVA_POSHTA_API_KEY`
- `UKRPOSHTA_ECOM_BEARER`
- `UKRPOSHTA_STATUS_BEARER`
- `UKRPOSHTA_COUNTERPARTY_TOKEN`
- `MEEST_API_TOKEN`
- `MEEST_CONTRACT_ID`

## Правило будущих изменений

Если задача касается одного перевозчика, сначала изучать:

```text
AGENTS.md
types.ts
carriers/<carrier>.ts
```

`worker.ts`, `storage.ts`, `normalize.ts` и другие carrier-модули открывать только при необходимости. Не переписывать рабочую production-логику без отдельной задачи.
