# Meal Planner

A weekly meal planning app for tracking baby and adult meals, with a web interface and MagTag e-ink display integration.

## Tech Stack

- **Backend**: Node.js + Express + TypeScript
- **Database**: SQLite via better-sqlite3 (WAL mode)
- **Frontend**: Vanilla JavaScript, HTML, CSS (no framework)
- **Hardware**: Adafruit MagTag e-ink display (CircuitPython)

## Project Structure

```
meal-planner/
├── src/                    # Server-side TypeScript source
│   ├── types/
│   │   └── index.ts        # Shared type definitions
│   ├── server.ts           # Express server entry point
│   ├── db.ts               # Database layer (SQLite)
│   ├── logger.ts           # Structured logging module
│   └── config.ts           # Centralized configuration
├── scripts/                # Utility scripts
│   └── seed.ts             # Database seeder
├── dist/                   # Compiled JavaScript (gitignored)
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
├── tsconfig.json           # TypeScript configuration
└── package.json
```

## Commands

```bash
npm run build      # Compile TypeScript to dist/
npm start          # Start compiled server (default port 3000)
npm run start:dev  # Start dev server with hot reload (tsx)
npm run seed       # Seed database with sample data
npm run typecheck  # Run TypeScript type checker
npm run deploy     # Build and rsync to production server
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
- Baby breakfast: `baby_breakfast_cereal`, `baby_breakfast_fruit`, `baby_breakfast_yogurt`
- Baby lunch: `baby_lunch_meat`, `baby_lunch_vegetable`, `baby_lunch_fruit`
- Baby dinner: `baby_dinner_meat`, `baby_dinner_vegetable`, `baby_dinner_fruit`
- Adult: `adult_dinner`
- `note` - Day-level note field

## Frontend Notes

- Auto-saves on input with 400ms debounce
- Visual feedback: green border during save
- Today's card highlighted with amber/cream colors
- Clicking "Today" button scrolls to today's card
- Meal section order: Adult Dinner → Baby Breakfast → Baby Lunch → Baby Dinner
- Emoji icons on section headers (🍽️ 🥣 🍼 👶)

## MagTag Display

The MagTag fetches from `/api/schedule/upcoming` and displays:
- Current day's meals in large text
- Button navigation: D (prev day), C (next day), A (refresh)
- Shows MAC address and IP on loading screen
- Configured via `magtag/settings.toml`

## Timezone

All date calculations use **America/New_York** (US Eastern).
