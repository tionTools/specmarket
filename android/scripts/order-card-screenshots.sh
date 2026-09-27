#!/usr/bin/env bash
set -euo pipefail

sdkmanager 'platforms;android-37.0' 'build-tools;36.0.0'
./gradlew testDebugUnitTest lintDebug assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk

mkdir -p card-review-screenshots
adb shell settings put system accelerometer_rotation 0
adb shell settings put system user_rotation 0
adb shell wm density 160

for width in 320 360 393; do
  adb shell wm size "${width}x900"
  for scale in 1.0 1.3; do
    adb shell settings put system font_scale "$scale"
    for scenario in long many no-ttn; do
      adb shell am force-stop ua.orders.crm || true
      adb shell am start -W -n ua.orders.crm/.OrderCardReviewActivity --es scenario "$scenario"
      sleep 3
      output="card-review-screenshots/${width}dp-font${scale}-${scenario}.png"
      adb exec-out screencap -p > "$output"
      test -s "$output"
      file "$output" | grep -q 'PNG image data'
      echo "Captured $output"
    done
  done
done

adb shell wm size reset
adb shell wm density reset
adb shell settings put system font_scale 1.0
