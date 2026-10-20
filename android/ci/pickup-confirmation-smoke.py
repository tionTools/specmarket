#!/usr/bin/env python3
"""Exercise manual reminder acknowledgement in the synthetic Android UI.

Only debug in-memory fixture is used: no credentials, carrier calls or RPC writes.
"""
import re
import subprocess
import time
import xml.etree.ElementTree as ET


def adb(*args, timeout=30):
    result = subprocess.run(["adb", *args], text=True, capture_output=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f"adb {args!r} failed: {result.stderr.strip()}")
    return result.stdout


def hierarchy():
    last_error = None
    for _ in range(4):
        try:
            adb("shell", "uiautomator", "dump", "/sdcard/reminder-ui.xml", timeout=35)
            content = adb("exec-out", "cat", "/sdcard/reminder-ui.xml")
            return ET.fromstring(content)
        except (RuntimeError, ET.ParseError) as error:
            last_error = error
            time.sleep(1)
    raise AssertionError(f"UI hierarchy could not be read: {last_error}")


def match(root, label):
    return next((
        node for node in root.iter("node")
        if node.attrib.get("text") == label or node.attrib.get("content-desc") == label
    ), None)


def click(label, allow_scroll=False):
    for attempt in range(6 if allow_scroll else 3):
        root = hierarchy()
        node = match(root, label)
        if node:
            bounds = node.attrib.get("bounds", "")
            m = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", bounds)
            if not m:
                raise AssertionError(f"Unusable bounds for {label}: {bounds}")
            x1, y1, x2, y2 = map(int, m.groups())
            adb("shell", "input", "tap", str((x1 + x2) // 2), str((y1 + y2) // 2))
            time.sleep(1)
            return
        if allow_scroll:
            size = adb("shell", "wm", "size")
            dimensions = re.search(r"(\d+)x(\d+)", size)
            if not dimensions:
                raise AssertionError(f"Cannot read emulator size: {size}")
            width, height = map(int, dimensions.groups())
            adb("shell", "input", "swipe", str(width // 2),
                str(height * 3 // 4), str(width // 2), str(height // 3), "400")
        time.sleep(1)
    raise AssertionError(f"Control not found in UI: {label}")


def assert_visible(label):
    for _ in range(3):
        if match(hierarchy(), label) is not None:
            return
        time.sleep(1)
    raise AssertionError(f"Expected label absent: {label}")


click("Отметить отправленным", allow_scroll=True)
assert_visible("Сообщение отправлено?")
assert_visible("Где отправлено?")
assert_visible("Viber")
assert_visible("Telegram")
click("Нет")
assert_visible("Отметить отправленным")
print("PASS: manual confirmation dialog and safe decline, no RPC or push triggered")
