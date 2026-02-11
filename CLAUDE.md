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
- `PUT /api/weeks/:weekOf/days/:day/consume` - Mark baby meal as consumed
- `PUT /api/weeks/:weekOf/days/:day/unconsume` - Unmark baby meal as consumed
- `GET /api/weeks` - List all saved weeks
- `POST /api/weeks/:weekOf/copy` - Copy week to new date
- `DELETE /api/weeks/:weekOf` - Delete a week

### Inventory API
- `GET /api/inventory?lookahead=N&today=YYYY-MM-DD` - Get inventory status (N: 3, 5, or 7 days)
- `PUT /api/inventory/:ingredient` - Update stock level (body: `{stock: N}`, `{delta: N}`, or `{pinned: bool, category?: string}`)
- `POST /api/inventory` - Add manual inventory item (body: `{ingredient, category}`)
- `DELETE /api/inventory/:ingredient` - Delete a manual (pinned) inventory item

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
- Consumed flags: `baby_breakfast_consumed`, `baby_lunch_consumed`, `baby_dinner_consumed` (0/1)
- Adult: `adult_dinner`
- `note` - Day-level note field

**inventory** table:
- `ingredient` (TEXT, UNIQUE, normalized lowercase)
- `stock` (INTEGER, current quantity on hand)
- `category` (TEXT, one of: meat/vegetable/fruit/cereal/yogurt)
- `pinned` (INTEGER, 0/1 — 1 = manually added, persists at stock=0)

## Frontend Notes

- Auto-saves on input with 400ms debounce
- Visual feedback: green border during save
- Today's card highlighted with amber/cream colors
- Clicking "Today" button scrolls to today's card
- Meal section order: Adult Dinner → Baby Breakfast → Baby Lunch → Baby Dinner
- Emoji icons on section headers (🍽️ 🥣 🍼 👶)

### Inventory Page
- Accessed via "Inventory" button in header
- Shows baby meal ingredients needed vs stock on hand
- Configurable lookahead: 3, 5, or 7 days
- Ingredients grouped: "Items to Make" (needed > stock) vs "Other Stock"
- Stock adjustable via +/- buttons
- Baby meal sections have checkmark toggles to mark meals as consumed
- "+ Add Item" button for manually adding ingredients with a category
- Manual items are pinned (persist at stock=0) and can be deleted via × button
- Pin toggle button on all items: click to pin (persist beyond lookahead) or unpin (revert to auto)

## Background Tasks

### Auto-Complete Past Meals
- Every 5 minutes (and once on startup), the server checks for past baby meals that were never marked as consumed
- Any past day (before today in Eastern time) with unconsumed baby meals that have non-empty ingredients is auto-completed
- Uses the same `consumeMeal()` function as the UI — sets the consumed flag and decrements inventory stock atomically
- Configured via `config.autoCompleteIntervalMs` (default: 5 minutes)

## MagTag Display

The MagTag fetches from `/api/schedule/upcoming` and displays:
- Current day's meals in large text
- Button navigation: D (prev day), C (next day), A (refresh)
- Shows MAC address and IP on loading screen
- Configured via `magtag/settings.toml`

## Versioning

This project uses **semantic versioning** (semver). The version in `package.json` is the source of truth.

### When committing changes, determine the version bump:
- **patch** (1.0.0 → 1.0.1): Bug fixes, typo corrections, minor tweaks
- **minor** (1.0.0 → 1.1.0): New features, new API endpoints, new UI pages/sections
- **major** (1.0.0 → 2.0.0): Breaking changes to API contracts (endpoints used by MagTag/Home Assistant)

### After committing, run the appropriate bump command:
```bash
npm version patch   # bug fixes
npm version minor   # new features
npm version major   # breaking API changes
```

This automatically: updates package.json, creates a git commit, creates a git tag, and pushes to remote.

### Rules:
- **Always bump the version after completing a feature or fix** — do not leave the version stale
- If multiple features/fixes are committed together, use the highest applicable bump (feat + fix = minor)
- The `preversion` script runs typecheck + tests — if they fail, fix them before versioning
- Do NOT manually edit the `version` field in package.json — always use `npm version`

## Timezone

All date calculations use **America/New_York** (US Eastern).
