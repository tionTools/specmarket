# Patch 52: аудит реализации

Аудит исходного diff выявил каркас вместо законченной v0.1. В частности,
отсутствовали Realtime, refresh при возврате, paging из UI, структурированные детали,
настройки, цвета и разбор результата принятия. Ниже — проверка после доработки.

| Требование 52.txt / README | Фактическая реализация и проверка |
| --- | --- |
| Отдельный native Android проект | `android/`, Kotlin + Compose, независимый Gradle; корневые pnpm/Vite настройки не менялись. |
| Имя «Заказы» | Manifest launcher label, Login и заголовок списка; видимого SpecMarket в Kotlin/resources нет. |
| Фиксированный toolchain | AGP 9.4.0, Gradle 9.6.0, Kotlin/Compose compiler 2.3.21, Compose BOM 2026.08.00, JDK 17, minSdk 26 / targetSdk 36 / compileSdk 37. SDK package называется `platforms;android-37.0`. |
| Gradle wrapper | Официальные gradlew, gradlew.bat, wrapper JAR и properties. Скрипт для Linux должен иметь git mode 100755. |
| Совместимый Supabase client | BOM 3.6.0 + Auth/Postgrest/Realtime/Functions; Ktor OkHttp 3.4.3 (WebSocket); serialization 1.11.0, как в версии 3.6.0 upstream. |
| Те же client credentials | URL и publishable key совпадают с fallback web `src/lib/supabase.ts`; административные ключи отсутствуют. |
| Email/password login | Repository вызывает Auth.signInWith(Email). Email вводится отдельно, пароль маскируется, поле очищается при отправке и не сохраняется в saved state. |
| Восстановление / обновление сессии | Штатный Auth session manager с auto-load/auto-refresh; ViewModel наблюдает sessionStatus и состояние Initializing; backup приложения отключён. |
| Гость | Вход guest@gmail.com отклоняется; canAccept дополнительно проверяет email. Backend также проверяет guest после getUser. |
| Ошибки / приватность | Пользовательские сообщения без stack trace; LogLevel.NONE; нет логирования customer payload, паролей или токенов. |
| Экран и фильтры | Заказы, refresh, pull-to-refresh, Новые/Все, состояния загрузки и пустого результата. Фильтр новых применяется к загруженному окну истории, что разрешено спецификацией. |
| Реальные данные | Явный select crm_orders с вложенными crm_order_items. Production-запрос limit=0 подтвердил колонки и foreign-key relationship (HTTP 200); строки клиентов не загружались. |
| DTO | Явные serializable Order/OrderItem; nullable поля; delivery — JsonElement с безопасным чтением примитивов и массивов. Тест неизвестных/nullable JSON. |
| История / paging | Пакеты по 50, сортировка updated_at DESC + id DESC, кнопка «Загрузить ещё», dedupe по id. Refresh возвращает начальное окно, отдельно обновляет открытый заказ. |
| Карточки | Площадка, номер/label, дата/время, статус, сумма, сводка всех товаров с размером и количеством. |
| Сумма | BigDecimal: сумма price × quantity, включая десятичные цены; тест нескольких строк, дробных цен и пустого заказа. |
| Цвета | Новые — синие; отмена/возврат — красные; завершённые — зелёные; остальные активные — оранжевые. Тест всех указанных spellings. |
| Полноценные детали | Отдельный прокручиваемый экран, а не JSON-диалог; товары, размер, qty/price, клиент/телефон, дата/время, номер, статус, сумма. |
| Доставка и оплата | carrier, recipient/recipientPhone, city/address, ttn, payer, trackingStatus; shipping отдельно; paymentMethod/paymentStatus/paymentAmount; пустые поля — «—». |
| История деталей | Структурированные shipmentHistory: ТТН, перевозчик, адрес, firstSeenAt/lastSeenAt; отсутствующие поля не ломают экран. |
| Realtime | Приватный существующий канал crm:orders / order_changed, тот же, что web. Подписка во foreground, отключение во background, retry, ручной fallback и refresh после подключения. |
| Изменение items | Существующий DB trigger touch_parent_crm_order_updated_at обновляет родителя и вызывает order_changed; дополнительных таблиц/публикаций не требуется. |
| Возврат на экран | Lifecycle ON_RESUME вызывает foreground(true) и ограниченный refresh; ON_PAUSE закрывает подписку. |
| Общий list/detail state | Событие перечитывает соответствующий id; DELETE удаляет карточку. Details хранят selectedId, данные заменяются новым серверным DTO. |
| Принятие Prom из UI | Только Пром + normalized new + допустимый externalId + личный аккаунт; большой button; AlertDialog с номером; запрет повторной отправки в полёте. |
| Authenticated function call | Functions client берёт JWT Auth-сессии; перед вызовом проверяется наличие сессии. Android не вызывает Prom напрямую. |
| Success / 409 / alreadyAccepted | Разбор JSON AcceptResponse и HTTP RestException.statusCode; сообщения пользователю; адресное перечитывание заказа после любого исхода. |
| Backend auth / cron | getUser до action, guest запрещён, cron credential или scheduled=true не могут выполнять accept. |
| Backend IDs | Строгий array, типы string/number, trim/prom prefix, пустые удаляются, dedupe, максимум 100, только положительные безопасные numeric IDs; tests. |
| Backend eligibility | Точные new/accepted allowlists; final/unknown/ложные accepted spellings запрещены. Отсутствующий или невалидный заказ вызывает 409 до API. |
| Backend Prom confirmation | POST orders/set_status status=received, только серверный токен. По официальной OrderStatus schema требуется подтверждение всех requested IDs в processed_ids; HTTP 200 сам по себе недостаточен. |
| Backend concurrent change | UPDATE ограничен id/platform/external_id + прежними status/updated_at; конфликт не затирается и возвращает 409. |
| Backend idempotency | Уже принятые заказы не вызывают API/UPDATE; возвращаются alreadyAccepted. Пустой accept-массив — no-op, не запускает sync. |
| Backend failure | При API failure CRM не меняется; неполный processed_ids не считается успехом; ошибки не маскируются ok=true. Deno tests. |
| Старый completion | completeExternalIds и последующая sync-логика сохранены; единственное изменение вне accept — явный тип Map<string,string> для Deno/TS 6. |
| Kasta/Epicentr | Только чтение, canAccept закрыт по площадке; тесты русских и латинских названий. |
| Settings/logout | Экран «Настройки», текущий email, logout с обработкой ошибок и очисткой состояния через Auth observer. |
| FCM / notification toggle | Отсутствуют, как требует v0.1. |
| Android tests | Новые/accepted/final статусы, цвета, Prom eligibility, guest/unauth, сумма, nullable/unknown DTO. |
| CI APK | workflow_dispatch и push main paths; JDK 17, Gradle cache, Android SDK setup, test/lint/assemble, artifact orders-android-debug; missing APK — ошибка. |
| Репозиторий | Только разрешённые Patch52 paths; build/APK/local.properties игнорируются; AGENTS.md не изменялся. |

## Проверки и воспроизведение

Deno: `deno test --no-lock supabase/functions/_shared/*_test.ts`.
Проверка Edge Function: `deno check --no-lock supabase/functions/sync-prom-orders/index.ts`.

Android: `gradlew.bat testDebugUnitTest lintDebug assembleDebug`.
На данном Windows-хосте JDK 17 не обрабатывает исходный кириллический
путь в Gradle test-worker argfile, а Java Unix-domain sockets требуют ASCII temp path.
Поэтому локальная сборка выполняется из точной копии Android-исходников в приватном
`C:\orders-patch52-private-20260906\android`, с отдельным ASCII Gradle cache
и `JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=C:\Windows\Temp`.
Права сборочного каталога: только текущий пользователь и SYSTEM.
Перед передачей APK исходники обеих копий сверяются по SHA-256.

Автоматические проверки не заменяют вход и подтверждение реального заказа на
телефоне владельца. В ходе разработки реальные заказы не принимались ради теста.

## Источники API

- [Supabase Kotlin 3.6.0 dependency versions](https://github.com/supabase-community/supabase-kt/blob/3.6.0/gradle/libs.versions.toml)
- [Prom set_status](https://public-api.docs.prom.ua/documentation/Orders/paths/PostOrdersStatus.yaml)
- [Prom processed_ids response](https://public-api.docs.prom.ua/documentation/Orders/schemas/OrderStatus.yaml)
