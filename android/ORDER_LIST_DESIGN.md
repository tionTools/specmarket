# Android order-list card: approved composition and visual acceptance

This is a *layout specification*, not a request to keep shaving dp values off the
old card. The previous 0.21 implementation stacked an oversized product/buyer
column, then a separate right-aligned price column, leaving unused space.
It also restricted long delivery checkpoints to one line.

## Phone composition (320–430 dp content width)

1. **Header (one row):** order number (small bold) with platform logo + date/time
   directly beneath it; order-status pill and small chevron at right. Do not give
   platform its own full-height row. Keep the source status and existing colors.
2. **Product (one row):** 72 dp square image at left, title at right (up to two
   lines), size and optional “Ещё N товаров” beneath. Use the existing image
   cache; do not fetch another picture for the card.
3. **Buyer (full-width line group):** person icon, readable name and phone.
   Do not squeeze them into a third column beside photo and prices.
4. **Money (one row + royalty line):** quantity × unit price at left and bold order
   total at right; royalty just under the total, aligned right. Totals are computed
   from all items. Do not infer missing royalty from a visual placeholder.
5. **TTN (one full-width colored strip):** green when a TTN number exists;
   otherwise use the existing orange tone. Icon at left; title, TTN + carrier,
   and a real carrier checkpoint at right. Checkpoint gets up to two normal lines;
   never render text vertically, never invent shipping promises or call a
   missing TTN “created”.

### Color, touch and behavior

- Retain the existing approved lilac selected filter, white rounded card,
  blue/green/orange/red status pills, green #EAF8F2 / #087B58 and
  orange #FFF3E2 / #B86300 TTN palette.
- Outer card 22 dp radius; TTN strip 16 dp radius. No fixed card height.
- Whole card remains tappable; filter/search/scroll restoration unchanged.
- Do not change business logic, royalty calculation, database queries or backend.
- Label “С ТТН” denotes a *created number*, not confirmation of carrier handoff.

### Review gate (before merge, before version bump, before APK publication)

The PR-only workflow `.github/workflows/android-ui-review.yml` boots a genuine
Android emulator and captures the **real production OrderCard composable**
using a debug-only Activity with clearly labeled synthetic order data. It
uploads screenshots at 320, 360 and 393 dp widths, font scales 1.0 and 1.3,
for long title/checkpoint, multiple items, and no-TTN scenarios. These are
real emulator captures, not generated design mockups. The debug-only fixture
is not present in the release APK and does not connect to the CRM.

Review the resulting GitHub Actions artifact against the approved visual
reference in the chat, including proportions and color. Also test actual
phone data after release; synthetic UI fixtures cannot verify remote photos
or every real marketplace status. The PR must not be merged on the basis of
a green Gradle check alone. Check no empty half-card region,
no narrow vertically broken text, and no unreadable clipping of required
content. Also verify return to the same list position after details.

**Do not merge or bump version solely because Gradle tests pass.** Build and
lint check code, not whether the layout is satisfactory. After the screenshot
review, run testDebugUnitTest, lintDebug, assembleRelease, verify the signed
APK, then choose the next versionCode (21 is already published).
