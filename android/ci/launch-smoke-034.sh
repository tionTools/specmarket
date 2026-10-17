#!/usr/bin/env bash
set -euo pipefail
mkdir -p validation
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb logcat -c
adb shell am start -W -n ua.orders.crm/.MainActivity
sleep 9
adb logcat -d -v time > validation/034-logcat.txt
adb shell dumpsys activity activities > validation/034-activities.txt
PID="$(adb shell pidof ua.orders.crm | tr -d '\r' || true)"
echo "Cold start PID: $PID"
if [[ -z "$PID" ]]; then
  echo "APP_CRASH_OR_EXIT"
  grep -A 40 -B 8 -E 'FATAL EXCEPTION|Process: ua.orders.crm|AndroidRuntime' validation/034-logcat.txt | tail -n 220 || true
  exit 1
fi
if grep -q 'Process: ua.orders.crm' validation/034-logcat.txt; then
  echo "APP_CRASH_LOGGED"
  grep -A 40 -B 8 'Process: ua.orders.crm' validation/034-logcat.txt | tail -n 220
  exit 1
fi
adb shell input keyevent 3
sleep 2
adb shell am start -W -n ua.orders.crm/.MainActivity
sleep 6
PID="$(adb shell pidof ua.orders.crm | tr -d '\r' || true)"
echo "Resume PID: $PID"
if [[ -z "$PID" ]]; then
  echo "APP_CRASH_ON_RESUME"
  exit 1
fi
# Exercise the authenticated-only Compose reminders UI with synthetic in-memory
# fixtures. No CRM login or production data is required.
adb shell am start -W -n ua.orders.crm/.PickupReminderPreviewActivity
sleep 7
PID="$(adb shell pidof ua.orders.crm | tr -d '\r' || true)"
if [[ -z "$PID" ]]; then
  echo "REMINDER_VIEW_CRASH"
  adb logcat -d -v time > validation/034-logcat.txt
  grep -A 40 -B 8 'Process: ua.orders.crm' validation/034-logcat.txt | tail -n 160 || true
  exit 1
fi
adb logcat -d -v time > validation/034-logcat.txt
if grep -q 'Process: ua.orders.crm' validation/034-logcat.txt; then
  echo "REMINDER_VIEW_FATAL_CRASH"
  exit 1
fi
adb exec-out screencap -p > validation/034-reminders.png
echo "PASS: cold launch + resume + populated reminder screen"
