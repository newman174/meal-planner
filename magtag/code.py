"""
Meal Planner display for Adafruit MagTag (ESP32-S2/S3, 2.9" e-ink).
Fetches the next 3 days from /api/schedule/upcoming and renders them
as single-day pages with button navigation.
Deep sleeps after idle timeout or on demand for battery life.

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
MAX_CHARS = WIDTH // CHAR_W  # ~49
LH = 14  # line height

DAY_FULL = {
    "Monday": "MONDAY", "Tuesday": "TUESDAY", "Wednesday": "WEDNESDAY",
    "Thursday": "THURSDAY", "Friday": "FRIDAY", "Saturday": "SATURDAY",
    "Sunday": "SUNDAY",
}

LOW_BATTERY_V = 3.5
DEBOUNCE_S = 0.3  # 300ms debounce between presses

# Status LEDs
leds = neopixel.NeoPixel(board.NEOPIXEL, 4, brightness=0.03)


# ── Helpers ─────────────────────────────────────────────────
def trunc(text, n=MAX_CHARS):
    """Truncate text to fit display width."""
    return text if len(text) <= n else text[: n - 2] + ".."


def white_background():
    """Create a white background tile."""
    bmp = displayio.Bitmap(WIDTH, HEIGHT, 1)
    pal = displayio.Palette(1)
    pal[0] = 0xFFFFFF
    return displayio.TileGrid(bmp, pixel_shader=pal)


def separator(y):
    """Create a 1px horizontal line."""
    bmp = displayio.Bitmap(WIDTH - 8, 1, 1)
    pal = displayio.Palette(1)
    pal[0] = 0x000000
    return displayio.TileGrid(bmp, pixel_shader=pal, x=4, y=y)


def _refresh_display():
    """Wait for e-ink cooldown, then refresh and block until done."""
    display = board.DISPLAY
    remaining = display.time_to_refresh
    if remaining > 0:
        print(f"Waiting {remaining:.1f}s for display cooldown")
        time.sleep(remaining)
    display.refresh()
    while display.busy:
        pass


# ── Battery ─────────────────────────────────────────────────
def read_battery_voltage():
    """Read battery voltage via the MagTag's 2x voltage divider."""
    adc = analogio.AnalogIn(board.VOLTAGE_MONITOR)
    voltage = (adc.value / 65535) * 3.3 * 2
    adc.deinit()
    return voltage


# ── Buttons ─────────────────────────────────────────────────
def init_buttons():
    """Setup the 4 MagTag buttons as digital inputs with pull-ups.

    Returns list [A, B, C, D] mapped to pins D15, D14, D12, D11.
    Pressed when value == False.
    """
    pins = [board.D15, board.D14, board.D12, board.D11]
    buttons = []
    for pin in pins:
        btn = digitalio.DigitalInOut(pin)
        btn.direction = digitalio.Direction.INPUT
        btn.pull = digitalio.Pull.UP
        buttons.append(btn)
    return buttons


# ── NeoPixel feedback ───────────────────────────────────────
def flash_neopixels(color, duration=0.15):
    """Brief LED flash for button feedback."""
    leds.fill(color)
    time.sleep(duration)
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


def fetch(session):
    leds.fill((0, 0, 255))
    url = f"{API_BASE}/api/schedule/upcoming"
    print(f"Fetching {url}")
    resp = session.get(url)
    data = resp.json()
    resp.close()
    leds.fill((0, 0, 0))
    return data["days"]


# ── Display rendering ──────────────────────────────────────
def render_loading():
    """Show a loading splash screen on boot."""
    display = board.DISPLAY
    g = displayio.Group()
    g.append(white_background())
    g.append(Label(FONT, text="MEAL PLANNER", color=0x000000, x=4, y=10))
    g.append(separator(20))
    g.append(Label(FONT, text="Loading...", color=0x000000, x=4, y=40))
    display.root_group = g
    _refresh_display()


def _batt_str(batt):
    """Format battery voltage string with low-battery prefix."""
    s = f"{batt:.2f}v"
    if batt < LOW_BATTERY_V:
        s = "!" + s
    return s


def render_day(days, idx, batt):
    """Render a single day's meal plan on the full screen."""
    display = board.DISPLAY
    day = days[idx]
    g = displayio.Group()
    g.append(white_background())

    y = 6

    # ── Title row ──
    day_name = DAY_FULL.get(day["day"], day["day"].upper())
    title = day_name
    if idx == 0:
        title += " (Today)"
    g.append(Label(FONT, text=title, color=0x000000, x=4, y=y))

    # Right side: date, page indicator, battery voltage
    right = f"{day['date']}  {idx + 1}/{len(days)}  {_batt_str(batt)}"
    rx = WIDTH - len(right) * CHAR_W - 4
    g.append(Label(FONT, text=right, color=0x000000, x=rx, y=y))

    y += LH
    g.append(separator(y - 4))

    # ── Adult dinner ──
    dinner = day["adult"]["dinner"] or "-"
    g.append(Label(FONT, text=trunc(f"DINNER: {dinner}"), color=0x000000, x=4, y=y))
    y += LH

    # ── Note (only if non-empty) ──
    note = day["adult"]["note"]
    if note:
        g.append(
            Label(FONT, text=trunc(f"  Note: {note}"), color=0x000000, x=4, y=y)
        )
        y += LH

    # ── Separator before baby section ──
    g.append(separator(y - 4))

    # ── Baby meals — two columns ──
    bl = day["baby"]["lunch"]
    bd = day["baby"]["dinner"]
    col1_x = 4
    col2_x = 152

    # Column headers
    g.append(Label(FONT, text="BABY LUNCH", color=0x000000, x=col1_x, y=y))
    g.append(Label(FONT, text="BABY DINNER", color=0x000000, x=col2_x, y=y))
    y += LH

    # Cereal
    g.append(Label(FONT, text=f"Cereal: {bl.get('cereal') or '-'}", color=0x000000, x=col1_x, y=y))
    g.append(Label(FONT, text=f"Cereal: {bd.get('cereal') or '-'}", color=0x000000, x=col2_x, y=y))
    y += LH

    # Fruit
    g.append(Label(FONT, text=f"Fruit:  {bl.get('fruit') or '-'}", color=0x000000, x=col1_x, y=y))
    g.append(Label(FONT, text=f"Fruit:  {bd.get('fruit') or '-'}", color=0x000000, x=col2_x, y=y))
    y += LH

    # Yogurt / Vegetable
    g.append(Label(FONT, text=f"Yogurt: {bl.get('yogurt') or '-'}", color=0x000000, x=col1_x, y=y))
    g.append(Label(FONT, text=f"Veg:    {bd.get('vegetable') or '-'}", color=0x000000, x=col2_x, y=y))

    # ── Button legend at bottom ──
    legend = "[A]<  [B]>  [C]Refresh  [D]Sleep"
    g.append(Label(FONT, text=legend, color=0x000000, x=4, y=HEIGHT - 10))

    display.root_group = g
    _refresh_display()
    print(f"Rendered page {idx}: {day_name} {day['date']}")


def render_error(msg, batt=None):
    """Show an error screen with optional battery voltage."""
    display = board.DISPLAY
    g = displayio.Group()
    g.append(white_background())

    g.append(Label(FONT, text="MEAL PLANNER", color=0x000000, x=4, y=10))
    if batt is not None:
        bs = _batt_str(batt)
        g.append(
            Label(FONT, text=bs, color=0x000000,
                  x=WIDTH - len(bs) * CHAR_W - 4, y=10)
        )

    g.append(separator(20))
    g.append(Label(FONT, text="Could not fetch meals:", color=0x000000, x=4, y=34))
    g.append(Label(FONT, text=trunc(str(msg)), color=0x000000, x=4, y=52))
    g.append(
        Label(FONT, text=f"Retrying in {REFRESH_MINUTES}m", color=0x000000, x=4, y=74)
    )
    display.root_group = g
    _refresh_display()


# ── Deep sleep ──────────────────────────────────────────────
def deep_sleep():
    """Deep sleep to save battery. Board resets on wake, re-running code.py."""
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

batt = read_battery_voltage()
print(f"Battery: {batt:.2f}V")

days = None
try:
    days = fetch(session)
    leds.fill((0, 0, 0))
except Exception as e:
    leds.fill((255, 50, 0))
    print(f"Error: {e}")
    render_error(e, batt)
    time.sleep(0.5)
    deep_sleep()

# Render first day
current_page = 0
render_day(days, current_page, batt)

# ── Button poll loop ────────────────────────────────────────
buttons = init_buttons()
last_press = time.monotonic()
last_activity = time.monotonic()

while True:
    now = time.monotonic()

    # Idle timeout → deep sleep
    if now - last_activity >= IDLE_TIMEOUT_SECONDS:
        print("Idle timeout, entering deep sleep")
        deep_sleep()

    # Poll buttons (pressed when value == False)
    pressed = None
    for i, btn in enumerate(buttons):
        if not btn.value:
            if now - last_press >= DEBOUNCE_S:
                pressed = i
                last_press = now
                last_activity = now
            break

    if pressed == 0:  # A — Previous day
        flash_neopixels((255, 255, 255))
        if current_page > 0:
            current_page -= 1
            render_day(days, current_page, batt)
        print(f"Button A: page {current_page}")

    elif pressed == 1:  # B — Next day
        flash_neopixels((255, 255, 255))
        if current_page < len(days) - 1:
            current_page += 1
            render_day(days, current_page, batt)
        print(f"Button B: page {current_page}")

    elif pressed == 2:  # C — Refresh
        print("Button C: refreshing data")
        flash_neopixels((0, 0, 255))
        try:
            days = fetch(session)
            batt = read_battery_voltage()
            current_page = 0
            render_day(days, current_page, batt)
        except Exception as e:
            print(f"Refresh error: {e}")
            render_error(e, batt)

    elif pressed == 3:  # D — Deep sleep
        print("Button D: entering deep sleep")
        flash_neopixels((255, 0, 0))
        deep_sleep()

    time.sleep(0.1)  # 100ms poll interval
