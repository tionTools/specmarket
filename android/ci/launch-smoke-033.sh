#!/usr/bin/env bash
set -euo pipefail
mkdir -p validation
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb logcat -c
adb shell am start -W -n ua.orders.crm/.MainActivity
sleep 9
adb logcat -d -v time > validation/033-logcat.txt
adb shell dumpsys activity activities > validation/033-activities.txt
PID="$(adb shell pidof ua.orders.crm | tr -d '\r' || true)"
echo "Cold start PID: $PID"
if [[ -z "$PID" ]]; then
  echo "APP_CRASH_OR_EXIT"
  grep -A 40 -B 8 -E 'FATAL EXCEPTION|Process: ua.orders.crm|AndroidRuntime' validation/033-logcat.txt | tail -n 220 || true
  exit 1
fi
if grep -q 'Process: ua.orders.crm' validation/033-logcat.txt; then
  echo "APP_CRASH_LOGGED"
  grep -A 40 -B 8 'Process: ua.orders.crm' validation/033-logcat.txt | tail -n 220
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
adb logcat -d -v time > validation/033-logcat.txt
echo "PASS: Activity remains alive after cold launch and resume"
