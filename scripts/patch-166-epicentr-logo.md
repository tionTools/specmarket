# Patch 166 — compact differentiated Epicentr logo

## Status

PREPARED FOR CODEX.

Reviewed against main:
`dfa72299581a222baa8090ae7b2e4423e9e295d1`

The approved artwork is committed with this spec:
`scripts/assets/patch-166-epicentr-logo.png`.

Do not regenerate, redraw, recolor, stretch, or substitute another Epicentr logo. Use the committed PNG as the source of truth.

## Goal

Make Epicentr immediately distinguishable from Prom in both the web CRM and the native Android order list.

The current Epicentr artwork is visually too wide in the web order card and can run into the product thumbnail. The approved replacement is a compact horizontal mark:

- orange circular/down-arrow symbol on the left;
- blue `ЕПІЦЕНТР` wordmark on the right;
- transparent background;
- source asset size: 496 × 124 px;
- approximately 4:1 aspect ratio.

Prom and Kasta branding must remain unchanged.

## Confirmed current implementation

### Web CRM

`src/components/ui/PlatformLogo.vue`

Current mapping:
- Prom → `/platform-logos/prom.png`
- Kasta → `/platform-logos/kasta.png`
- Epicentr → `/platform-logos/epicentr.png`

Current Epicentr sizing:
`h-[2em] max-w-36`

The screenshot supplied by the user shows the current Epicentr logo reaching into the product thumbnail area.

### Android

`android/app/src/main/java/ua/orders/crm/MainActivity.kt`

`PlatformLogo()` maps:
- `"эпицентр", "епіцентр"` → `R.drawable.platform_epicentr`

Current Epicentr sizing:
- height: 22.dp
- max width: 96.dp

Important: the compact order card currently bypasses `PlatformLogo()` for Epicentr and renders a hard-coded blue `Text("Епіцентр")`. The successful Android UI-review workflow exposed this: replacing the drawable alone does not change the compact card.

The approved 4:1 asset fits the existing logo box without a sizing change: at 22.dp height its natural width is about 88.dp, below the existing 96.dp cap.

Current Android version:
- versionCode 25
- versionName "0.25"

## Required implementation

### 1. Web asset

Replace:
`public/platform-logos/epicentr.png`

with the approved source asset:
`scripts/assets/patch-166-epicentr-logo.png`

The resulting file must be byte-identical to the approved source asset.

### 2. Web sizing

In `src/components/ui/PlatformLogo.vue`, change only the Epicentr-specific sizing so the logo is narrower and cannot intrude into the product thumbnail.

Use:
`h-7 max-w-28`

for Epicentr.

Leave Prom/Kasta sizing and all other behavior unchanged.

Do not alter card layout, product thumbnail sizing, order columns, statuses, spacing outside the logo itself, or marketplace names.

### 3. Android asset

Replace:
`android/app/src/main/res/drawable-nodpi/platform_epicentr.png`

with the same approved source asset:
`scripts/assets/patch-166-epicentr-logo.png`

The resulting Android drawable must also be byte-identical to the approved source asset.

### 4. Android compact-card rendering

In `android/app/src/main/java/ua/orders/crm/MainActivity.kt`, remove the Epicentr-only hard-coded blue text branch in the compact order card and render `PlatformLogo(order.platform)` for Epicentr the same way as the other marketplaces.

Keep the existing `PlatformLogo()` mapping and Epicentr size values unchanged:
- 22.dp height;
- 96.dp max width.

Do not resize Prom or Kasta. Do not change order-card spacing or status/date layout.

### 5. Android version

Bump only:
- `versionCode`: 25 → 26
- `versionName`: "0.25" → "0.26"

No other Gradle/toolchain/dependency changes.

## Allowed scope

Only these files may change:

- `public/platform-logos/epicentr.png`
- `src/components/ui/PlatformLogo.vue`
- `android/app/src/main/res/drawable-nodpi/platform_epicentr.png`
- `android/app/src/main/java/ua/orders/crm/MainActivity.kt`
- `android/app/build.gradle.kts`
- `scripts/patch-166-epicentr-logo.md`
- `scripts/assets/patch-166-epicentr-logo.png`

No Supabase, marketplace sync, order logic, financial logic, tracking, notification, database, API, or unrelated UI changes.

## Verification

### Asset checks

Confirm with hashes that:

`scripts/assets/patch-166-epicentr-logo.png`
=
`public/platform-logos/epicentr.png`
=
`android/app/src/main/res/drawable-nodpi/platform_epicentr.png`

Confirm PNG dimensions are exactly 496 × 124 and background transparency is preserved.

### Web

Run in repository order:

1. `pnpm format` — do not accept unrelated formatter churn; revert any unrelated formatted files.
2. `pnpm type-check`
3. `pnpm lint`
4. `pnpm build`
5. `git diff --check`

Visually confirm on an order card:
- Epicentr no longer reaches the product thumbnail;
- orange symbol is clearly distinguishable from blue Prom;
- the wordmark remains readable;
- Prom and Kasta are unchanged.

### Android

Run:
- `gradlew.bat testDebugUnitTest`
- `gradlew.bat lintDebug`
- `gradlew.bat assembleDebug`

If the local Windows/SDK environment prevents a check, report the exact environment failure rather than changing the implementation.

Visually confirm on the real emulator compact-card scenario:
- Epicentr shows the orange-symbol/blue-wordmark image, not the old hard-coded blue text;
- no clipping;
- it remains on one horizontal line;
- the date/status/card spacing is unchanged;
- Prom/Kasta are unchanged.

## Stop conditions

Stop and report instead of expanding scope if:

- the approved source PNG cannot be used byte-for-byte in either target;
- web overlap persists even with `max-w-28`;
- Android clips the approved asset inside the existing 22.dp / 96.dp box;
- any required fix would change order-card layout or marketplace logic outside the allowed scope.

If Android alone clips, do not improvise. Report the observed dimensions/screenshot first.

## Delivery

After all checks PASS:

1. Keep the diff limited to the allowed files.
2. Commit the implementation to this branch.
3. Update the existing PR for Patch 166 rather than opening a second PR.
4. Do not merge until the user explicitly approves the final result.
5. Return:
   - final commit SHA;
   - exact changed files;
   - web checks;
   - Android checks;
   - APK version 0.26;
   - whether visual verification showed any overlap or clipping.
