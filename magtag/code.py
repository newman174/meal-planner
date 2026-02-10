"""
Meal Planner display for Adafruit MagTag (ESP32-S2/S3, 2.9" e-ink).
Fetches today's meals from /api/schedule/upcoming and renders them
with a high-contrast e-ink layout. Headless deep-sleep design for
maximum battery life — no polling loop, wakes on timer or button press.

Required CircuitPython libraries in /lib/:
  - adafruit_requests.mpy
  - adafruit_connection_manager.mpy
  - adafruit_display_text/  (folder)

Copy this file to CIRCUITPY/code.py and settings.toml to CIRCUITPY/settings.toml.
"""

import time
import os
import board
import displayio
import terminalio
import wifi
import socketpool
import digitalio
import analogio
import alarm
import adafruit_requests
from adafruit_display_text.label import Label

# ── Config ──────────────────────────────────────────────────
API_BASE = os.getenv("MEAL_PLANNER_URL")
REFRESH_MINUTES = int(os.getenv("REFRESH_MINUTES", "30"))

WIDTH = 296
HEIGHT = 128
FONT = terminalio.FONT
CHAR_W = 6
HEADER_H = 28
LOW_BATTERY_V = 3.5

# Button pins: A=D15, B=D14, C=D12, D=D11
PIN_BTN_A = board.D15
PIN_BTN_C = board.D12

# ── Disable NeoPixel/sensor power rail ──────────────────────
# The MagTag's NEOPIXEL_POWER pin gates power to the NeoPixels
# and LIS3DH accelerometer. Default is HIGH (on), wasting ~3-5mA.
_neopixel_power = digitalio.DigitalInOut(board.NEOPIXEL_POWER)
_neopixel_power.direction = digitalio.Direction.OUTPUT
_neopixel_power.value = False


# ── Graphics primitives ─────────────────────────────────────
def trunc(text, n):
    """Truncate text to n characters."""
    return text if len(text) <= n else text[: n - 2] + ".."


def word_wrap(text, n):
    """Split text into two lines, breaking at word boundary if possible."""
    if len(text) <= n:
        return text, ""
    break_at = text.rfind(" ", 0, n + 1)
    if break_at <= 0:
        break_at = n
    return text[:break_at].rstrip(), text[break_at:].lstrip()


def white_bg():
    bmp = displayio.Bitmap(WIDTH, HEIGHT, 1)
    pal = displayio.Palette(1)
    pal[0] = 0xFFFFFF
    return displayio.TileGrid(bmp, pixel_shader=pal)


def black_bar(w, h, x=0, y=0):
    bmp = displayio.Bitmap(w, h, 1)
    pal = displayio.Palette(1)
    pal[0] = 0x000000
    return displayio.TileGrid(bmp, pixel_shader=pal, x=x, y=y)


def hline(y, x=8, w=None):
    if w is None:
        w = WIDTH - 16
    bmp = displayio.Bitmap(w, 1, 1)
    pal = displayio.Palette(1)
    pal[0] = 0x000000
    return displayio.TileGrid(bmp, pixel_shader=pal, x=x, y=y)


def bullet(x, y, size=3):
    """Small filled square used as a list bullet."""
    bmp = displayio.Bitmap(size, size, 1)
    pal = displayio.Palette(1)
    pal[0] = 0x000000
    return displayio.TileGrid(bmp, pixel_shader=pal, x=x, y=y - size // 2)


def big_text(text, x, y, color=0x000000):
    """Label rendered at 2x scale via a scaled Group."""
    grp = displayio.Group(scale=2, x=x, y=y)
    grp.append(Label(FONT, text=text, color=color, x=0, y=0))
    return grp


# ── Hardware ────────────────────────────────────────────────
def read_battery():
    adc = analogio.AnalogIn(board.VOLTAGE_MONITOR)
    v = (adc.value / 65535) * 3.3 * 2
    adc.deinit()
    return v


# ── Network ─────────────────────────────────────────────────
def format_mac(mac_bytes):
    """Format MAC address bytes as colon-separated hex string."""
    return ":".join(f"{b:02X}" for b in mac_bytes)


def get_mac():
    return format_mac(wifi.radio.mac_address)


def connect():
    if wifi.radio.connected:
        return
    wifi.radio.enabled = True
    print("Connecting to WiFi...")
    wifi.radio.connect(
        os.getenv("CIRCUITPY_WIFI_SSID"),
        os.getenv("CIRCUITPY_WIFI_PASSWORD"),
    )
    print(f"Connected: {wifi.radio.ipv4_address}")


def fetch_today(session):
    url = f"{API_BASE}/api/schedule/upcoming"
    print(f"Fetching {url}")
    resp = session.get(url)
    data = resp.json()
    resp.close()
    return data["days"][0], data.get("updated_at", "")


# ── Display ─────────────────────────────────────────────────
def _refresh():
    d = board.DISPLAY
    r = d.time_to_refresh
    if r > 0:
        print(f"Waiting {r:.1f}s for display cooldown")
        time.sleep(r)
    d.refresh()
    while d.busy:
        pass


def render_loading(mac="", ip=""):
    d = board.DISPLAY
    g = displayio.Group()
    g.append(white_bg())
    g.append(black_bar(WIDTH, HEADER_H))
    g.append(Label(FONT, text="MEAL PLANNER", color=0xFFFFFF, x=8, y=HEADER_H // 2))
    g.append(Label(FONT, text="Connecting...", color=0x000000, x=8, y=HEADER_H + 20))
    if mac:
        g.append(Label(FONT, text=f"MAC: {mac}", color=0x000000, x=8, y=HEADER_H + 36))
    if ip:
        g.append(Label(FONT, text=f"IP:  {ip}", color=0x000000, x=8, y=HEADER_H + 52))
    d.root_group = g
    _refresh()


def render_today(day, batt, updated_at=""):
    """Render today's meal plan with large text and clean layout."""
    d = board.DISPLAY
    g = displayio.Group()
    g.append(white_bg())

    # ── Black header bar ──
    g.append(black_bar(WIDTH, HEADER_H))

    # Day name at 2x scale (white on black)
    day_name = day["day"].upper()
    g.append(big_text(day_name, x=6, y=HEADER_H // 2, color=0xFFFFFF))

    # Date + update time + battery (small, white on black, right-aligned)
    batt_s = f"{batt:.1f}v"
    if batt < LOW_BATTERY_V:
        batt_s = "!" + batt_s
    time_part = f" {updated_at}" if updated_at else ""
    info = f"{day['date']}{time_part}  {batt_s}"
    g.append(Label(FONT, text=info, color=0xFFFFFF,
                   x=WIDTH - len(info) * CHAR_W - 6, y=HEADER_H // 2))

    y = HEADER_H + 12

    # ── Dinner (2x scale, wrap to 2 lines if needed) ──
    dinner = day["adult"]["dinner"] or "-"
    max_big = (WIDTH - 16) // (CHAR_W * 2)  # ~23 chars at 2x
    if len(dinner) <= max_big:
        g.append(big_text(dinner, x=6, y=y))
        y += 20
    else:
        line1, line2 = word_wrap(dinner, max_big)
        g.append(big_text(line1, x=6, y=y))
        y += 22
        g.append(big_text(trunc(line2, max_big) if len(line2) > max_big else line2, x=6, y=y))
        y += 16

    y += 2
    g.append(hline(y))
    y += 8

    # ── Baby meals — three columns: breakfast, lunch, dinner ──
    bb = day["baby"]["breakfast"]
    bl = day["baby"]["lunch"]
    bd = day["baby"]["dinner"]
    c1 = 8
    c2 = 104
    c3 = 200

    g.append(Label(FONT, text="BREAKFAST", color=0x000000, x=c1, y=y))
    g.append(Label(FONT, text="LUNCH", color=0x000000, x=c2, y=y))
    g.append(Label(FONT, text="DINNER", color=0x000000, x=c3, y=y))
    y += 11

    bfast_items = [v for v in [bb.get("cereal"), bb.get("yogurt"), bb.get("fruit")] if v]
    lunch_items = [v for v in [bl.get("meat"), bl.get("vegetable"), bl.get("fruit")] if v]
    dinner_items = [v for v in [bd.get("meat"), bd.get("vegetable"), bd.get("fruit")] if v]

    max_rows = max(len(bfast_items), len(lunch_items), len(dinner_items))
    for i in range(max_rows):
        if i < len(bfast_items):
            g.append(bullet(c1, y))
            g.append(Label(FONT, text=trunc(bfast_items[i], 14), color=0x000000, x=c1 + 8, y=y))
        if i < len(lunch_items):
            g.append(bullet(c2, y))
            g.append(Label(FONT, text=trunc(lunch_items[i], 14), color=0x000000, x=c2 + 8, y=y))
        if i < len(dinner_items):
            g.append(bullet(c3, y))
            g.append(Label(FONT, text=trunc(dinner_items[i], 14), color=0x000000, x=c3 + 8, y=y))
        y += 11

    d.root_group = g
    _refresh()
    print(f"Rendered: {day['day']} {day['date']}")


def render_error(msg, batt=None):
    d = board.DISPLAY
    g = displayio.Group()
    g.append(white_bg())
    g.append(black_bar(WIDTH, HEADER_H))
    g.append(Label(FONT, text="MEAL PLANNER", color=0xFFFFFF, x=8, y=HEADER_H // 2))
    if batt is not None:
        bs = f"{batt:.1f}v"
        g.append(Label(FONT, text=bs, color=0xFFFFFF,
                       x=WIDTH - len(bs) * CHAR_W - 6, y=HEADER_H // 2))
    g.append(Label(FONT, text="Could not load meals:", color=0x000000, x=8, y=HEADER_H + 14))
    g.append(Label(FONT, text=trunc(str(msg), (WIDTH - 16) // CHAR_W),
                   color=0x000000, x=8, y=HEADER_H + 30))
    g.append(Label(FONT, text=f"Retrying in {REFRESH_MINUTES}m",
                   color=0x000000, x=8, y=HEADER_H + 50))
    d.root_group = g
    _refresh()


# ── Deep sleep ──────────────────────────────────────────────
def deep_sleep():
    print(f"Deep sleeping for {REFRESH_MINUTES} minutes...")

    # Wait for e-ink to finish — active refresh draws significant current
    while board.DISPLAY.busy:
        time.sleep(0.1)

    # Disable WiFi radio before sleeping
    wifi.radio.enabled = False

    # Timer wake: refresh on schedule
    ta = alarm.time.TimeAlarm(
        monotonic_time=time.monotonic() + REFRESH_MINUTES * 60
    )
    # Button wake: A (manual refresh) and C (manual refresh)
    ba = alarm.pin.PinAlarm(pin=PIN_BTN_A, value=False, pull=True)
    bc = alarm.pin.PinAlarm(pin=PIN_BTN_C, value=False, pull=True)

    alarm.exit_and_deep_sleep_until_alarms(ta, ba, bc)


# ── Main ────────────────────────────────────────────────────
# Detect what woke us — deep sleep resets the CPU, so code.py
# runs from the top each time. alarm.wake_alarm tells us why.
wake = alarm.wake_alarm
if isinstance(wake, alarm.pin.PinAlarm):
    print(f"Woke by button: {wake.pin}")
elif isinstance(wake, alarm.time.TimeAlarm):
    print("Woke by timer")
else:
    print("Fresh boot (power-on/reset)")

# Only show loading screen on fresh boot (not timer/button wake)
mac = get_mac()
print(f"MAC: {mac}")
if wake is None:
    render_loading(mac=mac)

connect()
ip = str(wifi.radio.ipv4_address)
print(f"IP:  {ip}")

# Show loading with IP only on fresh boot
if wake is None:
    render_loading(mac=mac, ip=ip)

pool = socketpool.SocketPool(wifi.radio)
session = adafruit_requests.Session(pool)

batt = read_battery()
print(f"Battery: {batt:.2f}V")

try:
    today, updated_at = fetch_today(session)
except Exception as e:
    print(f"Error: {e}")
    render_error(e, batt)
    deep_sleep()

# Render meals, disable WiFi, deep sleep immediately
render_today(today, batt, updated_at)
wifi.radio.enabled = False
print("WiFi disabled")
deep_sleep()
