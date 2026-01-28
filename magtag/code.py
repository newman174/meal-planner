"""
Meal Planner display for Adafruit MagTag (ESP32-S2/S3, 2.9" e-ink).
Fetches today's meals from /api/schedule/upcoming and renders them
with a high-contrast e-ink layout. Deep sleeps for battery life.

Required CircuitPython libraries in /lib/:
  - adafruit_requests.mpy
  - adafruit_connection_manager.mpy
  - adafruit_display_text/  (folder)
  - neopixel.mpy

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
import adafruit_requests
import neopixel
from adafruit_display_text.label import Label

# ── Config ──────────────────────────────────────────────────
API_BASE = os.getenv("MEAL_PLANNER_URL")
REFRESH_MINUTES = int(os.getenv("REFRESH_MINUTES", "30"))
IDLE_TIMEOUT_SECONDS = int(os.getenv("IDLE_TIMEOUT_SECONDS", "120"))

WIDTH = 296
HEIGHT = 128
FONT = terminalio.FONT
CHAR_W = 6
HEADER_H = 28
LOW_BATTERY_V = 3.5
DEBOUNCE_S = 0.3

leds = neopixel.NeoPixel(board.NEOPIXEL, 4, brightness=0.03)


# ── Graphics primitives ─────────────────────────────────────
def trunc(text, n):
    """Truncate text to n characters."""
    return text if len(text) <= n else text[: n - 2] + ".."


def word_wrap(text, n):
    """Split text into two lines, breaking at word boundary if possible."""
    if len(text) <= n:
        return text, ""
    # Find last space within limit
    break_at = text.rfind(" ", 0, n + 1)
    if break_at <= 0:
        # No space found, hard break
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


def init_buttons():
    pins = [board.D15, board.D14, board.D12, board.D11]
    btns = []
    for p in pins:
        b = digitalio.DigitalInOut(p)
        b.direction = digitalio.Direction.INPUT
        b.pull = digitalio.Pull.UP
        btns.append(b)
    return btns


def flash(color, dur=0.15):
    leds.fill(color)
    time.sleep(dur)
    leds.fill((0, 0, 0))


# ── Network ─────────────────────────────────────────────────
def connect():
    if wifi.radio.connected:
        return
    leds.fill((255, 0, 0))
    print("Connecting to WiFi...")
    wifi.radio.connect(
        os.getenv("CIRCUITPY_WIFI_SSID"),
        os.getenv("CIRCUITPY_WIFI_PASSWORD"),
    )
    print(f"Connected: {wifi.radio.ipv4_address}")


def fetch_today(session):
    leds.fill((0, 0, 255))
    url = f"{API_BASE}/api/schedule/upcoming"
    print(f"Fetching {url}")
    resp = session.get(url)
    data = resp.json()
    resp.close()
    leds.fill((0, 0, 0))
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


def render_loading():
    d = board.DISPLAY
    g = displayio.Group()
    g.append(white_bg())
    g.append(black_bar(WIDTH, HEADER_H))
    g.append(Label(FONT, text="MEAL PLANNER", color=0xFFFFFF, x=8, y=HEADER_H // 2))
    g.append(Label(FONT, text="Connecting...", color=0x000000, x=8, y=HEADER_H + 20))
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
        # Wrap at word boundary
        line1, line2 = word_wrap(dinner, max_big)
        g.append(big_text(line1, x=6, y=y))
        y += 18
        g.append(big_text(trunc(line2, max_big) if len(line2) > max_big else line2, x=6, y=y))
        y += 20

    y += 2
    g.append(hline(y))
    y += 8

    # ── Baby meals — two columns, items only (no field labels) ──
    bl = day["baby"]["lunch"]
    bd = day["baby"]["dinner"]
    c1 = 8
    c2 = 152

    g.append(Label(FONT, text="LUNCH", color=0x000000, x=c1, y=y))
    g.append(Label(FONT, text="DINNER", color=0x000000, x=c2, y=y))
    y += 11

    lunch_items = [v for v in [bl.get("cereal"), bl.get("fruit"), bl.get("yogurt")] if v]
    dinner_items = [v for v in [bd.get("cereal"), bd.get("fruit"), bd.get("vegetable")] if v]

    for i in range(max(len(lunch_items), len(dinner_items))):
        if i < len(lunch_items):
            g.append(bullet(c1, y))
            g.append(Label(FONT, text=lunch_items[i], color=0x000000, x=c1 + 8, y=y))
        if i < len(dinner_items):
            g.append(bullet(c2, y))
            g.append(Label(FONT, text=dinner_items[i], color=0x000000, x=c2 + 8, y=y))
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
    leds.fill((0, 0, 0))
    try:
        import alarm

        ta = alarm.time.TimeAlarm(
            monotonic_time=time.monotonic() + REFRESH_MINUTES * 60
        )
        alarm.exit_and_deep_sleep_until_alarms(ta)
    except ImportError:
        time.sleep(REFRESH_MINUTES * 60)


# ── Main ────────────────────────────────────────────────────
render_loading()
connect()

pool = socketpool.SocketPool(wifi.radio)
session = adafruit_requests.Session(pool)

batt = read_battery()
print(f"Battery: {batt:.2f}V")

today = None
updated_at = ""
try:
    today, updated_at = fetch_today(session)
    leds.fill((0, 0, 0))
except Exception as e:
    leds.fill((255, 50, 0))
    print(f"Error: {e}")
    render_error(e, batt)
    time.sleep(0.5)
    deep_sleep()

render_today(today, batt, updated_at)

# ── Button loop (C=refresh, D=sleep) ───────────────────────
buttons = init_buttons()
last_press = time.monotonic()
last_activity = time.monotonic()

while True:
    now = time.monotonic()

    if now - last_activity >= IDLE_TIMEOUT_SECONDS:
        print("Idle timeout, entering deep sleep")
        deep_sleep()

    pressed = None
    for i, btn in enumerate(buttons):
        if not btn.value:
            if now - last_press >= DEBOUNCE_S:
                pressed = i
                last_press = now
                last_activity = now
            break

    if pressed == 2:  # C — Refresh
        print("Refreshing data")
        flash((0, 0, 255))
        try:
            today, updated_at = fetch_today(session)
            batt = read_battery()
            render_today(today, batt, updated_at)
        except Exception as e:
            print(f"Refresh error: {e}")
            render_error(e, batt)

    elif pressed == 3:  # D — Sleep
        print("Entering deep sleep")
        flash((255, 0, 0))
        deep_sleep()

    time.sleep(0.1)
