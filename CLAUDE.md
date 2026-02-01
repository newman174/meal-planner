# Meal Planner

A weekly meal planning app for tracking baby and adult meals, with a web interface and MagTag e-ink display integration.

## Tech Stack

- **Backend**: Node.js + Express
- **Database**: SQLite via better-sqlite3 (WAL mode)
- **Frontend**: Vanilla JavaScript, HTML, CSS (no framework)
- **Hardware**: Adafruit MagTag e-ink display (CircuitPython)

## Project Structure

```
meal-planner/
├── src/                    # Server-side source code
│   ├── server.js           # Express server entry point
│   ├── db.js               # Database layer (SQLite)
│   ├── logger.js           # Structured logging module
│   └── config.js           # Centralized configuration
├── scripts/                # Utility scripts
│   └── seed.js             # Database seeder
├── public/                 # Frontend static files
│   ├── index.html          # Main HTML page
│   ├── app.js              # Frontend JavaScript (vanilla)
│   ├── style.css           # Styles (modern gradient design)
│   └── favicon.svg         # App icon
├── magtag/                 # MagTag e-ink display code
│   ├── code.py             # CircuitPython code for MagTag
│   └── settings.toml       # WiFi/server config
├── logs/                   # Log files (production)
├── meals.db                # SQLite database file
└── package.json
```

## Commands

```bash
npm start          # Start server (default port 3000)
npm run seed       # Seed database with sample data
npm run deploy     # Rsync to production server (192.168.50.193)
```

## API Endpoints

### App API (used by frontend)
- `GET /api/weeks/:weekOf` - Get week data (creates if not exists)
- `PUT /api/weeks/:weekOf/days/:day` - Update a day's meals (day: 0-6)
- `GET /api/weeks` - List all saved weeks
- `POST /api/weeks/:weekOf/copy` - Copy week to new date
- `DELETE /api/weeks/:weekOf` - Delete a week

### Public API (for Home Assistant/MagTag)
- `GET /api/schedule/current` - Current week's meals
- `GET /api/schedule/upcoming` - Today + next 2 days
- `GET /api/schedule/:weekOf` - Specific week formatted for display

## Database Schema

**weeks** table:
- `id`, `week_of` (TEXT, YYYY-MM-DD of Monday)

**days** table:
- `week_id`, `day` (0=Monday, 6=Sunday)
- Baby lunch: `baby_lunch_cereal`, `baby_lunch_fruit`, `baby_lunch_yogurt`
- Baby dinner: `baby_dinner_cereal`, `baby_dinner_fruit`, `baby_dinner_vegetable`
- Adult: `adult_dinner`
- `note` - Day-level note field

## Frontend Notes

- Auto-saves on input with 400ms debounce
- Visual feedback: green border during save
- Today's card highlighted with amber/cream colors
- Clicking "Today" button scrolls to today's card
- Meal section order: Adult Dinner → Baby Lunch → Baby Dinner
- Emoji icons on section headers (🍽️ 🍼 👶)

## MagTag Display

The MagTag fetches from `/api/schedule/upcoming` and displays:
- Current day's meals in large text
- Button navigation: D (prev day), C (next day), A (refresh)
- Shows MAC address and IP on loading screen
- Configured via `magtag/settings.toml`

## Timezone

All date calculations use **America/New_York** (US Eastern).
