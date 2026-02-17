# Meal Planner

A weekly meal planning app for tracking baby and adult meals, with a web interface and MagTag e-ink display integration.

## Tech Stack

- **Backend**: Node.js + Express + TypeScript
- **Database**: SQLite via better-sqlite3 (WAL mode)
- **Frontend**: Vanilla JavaScript, HTML, CSS (no framework)
- **Testing**: Vitest + Supertest (API) + jsdom (frontend)
- **Security**: Helmet (headers) + express-rate-limit
- **Logging**: Pino (structured) + pino-roll (rotation, optional)
- **Deployment**: PM2 (process manager) + rsync to production
- **Hardware**: Adafruit MagTag e-ink display (CircuitPython)

## Project Structure

```
meal-planner/
├── src/                    # Server-side TypeScript source
│   ├── types/
│   │   └── index.ts        # Shared type definitions
│   ├── server.ts           # Express server entry point
│   ├── db.ts               # Database layer (SQLite)
│   ├── backup.ts           # Database backup with GFS-lite retention
│   ├── logger.ts           # Structured logging module
│   └── config.ts           # Centralized configuration
├── tests/                  # Test suite (Vitest)
│   ├── helpers/            # Shared test utilities
│   ├── integration/        # API + DB integration tests
│   ├── unit/               # Pure logic unit tests
│   └── frontend/           # jsdom-based frontend tests
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
├── backups/                # Database backups (gitignored)
├── logs/                   # Log files (production)
├── meals.db                # SQLite database file
├── vitest.config.ts        # Test configuration
├── ecosystem.config.cjs    # PM2 process manager config
├── tsconfig.json           # TypeScript configuration
└── package.json
```

## Commands

```bash
npm run build          # Compile TypeScript to dist/
npm start              # Start compiled server (default port 3000)
npm run start:dev      # Start dev server with hot reload (tsx)
npm run seed           # Seed database with sample data
npm run typecheck      # Run TypeScript type checker
npm test               # Run tests (vitest)
npm run test:watch     # Run tests in watch mode
npm run test:coverage  # Run tests with coverage report
npm run pm2:start      # Start with PM2 process manager
npm run pm2:logs       # View logs with pino-pretty formatting
npm run deploy         # Build and rsync to production server
```

## API Endpoints

### Utility API
- `GET /api/version` - Returns `{ version }` from package.json

### App API (used by frontend)
- `GET /api/weeks/:weekOf` - Get week data (creates if not exists)
- `PUT /api/weeks/:weekOf/days/:day` - Update a day's meals (day: 0-6)
- `PUT /api/weeks/:weekOf/days/:day/consume` - Mark baby meal as consumed
- `PUT /api/weeks/:weekOf/days/:day/unconsume` - Unmark baby meal as consumed
- `GET /api/weeks` - List all saved weeks
- `POST /api/weeks/:weekOf/copy` - Copy week to new date
- `DELETE /api/weeks/:weekOf` - Delete a week
- `GET /api/lookahead?days=N` - Raw day records for upcoming N days (3, 5, or 7) with weekOf/dayIndex metadata for inline editing

### Inventory API
- `GET /api/inventory?lookahead=N&today=YYYY-MM-DD` - Get inventory status (N: 3, 5, or 7 days)
- `GET /api/inventory/allocation?weekOf=YYYY-MM-DD` - Per-day, per-field allocation map showing stock coverage per meal ingredient
- `PUT /api/inventory/:ingredient` - Update inventory item (body: `{stock: N}`, `{delta: N}`, `{pinned: bool, category?: string}`, or `{noPrep: bool|null}`)
- `POST /api/inventory` - Add manual inventory item (body: `{ingredient, category}`)
- `DELETE /api/inventory/:ingredient` - Delete a manual (pinned) inventory item

### Backup API
- `GET /api/backups` - List all backups with metadata (filename, createdAt, sizeBytes)
- `POST /api/backup` - Trigger manual backup (201 on success, 429 if within 5-min cooldown)

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
- `ingredient` (TEXT, UNIQUE, title-cased with uppercase abbreviations preserved)
- `stock` (INTEGER, current quantity on hand, **floored at 0** — never negative)
- `category` (TEXT, one of: meat/vegetable/fruit/cereal/yogurt)
- `pinned` (INTEGER, 0/1 — 1 = manually added, persists at stock=0)
- `no_prep` (INTEGER, tri-state: NULL = use category default, 1 = no prep needed, 0 = prep needed; cereal/yogurt default to no-prep)

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
- No-prep attribute: items can be marked as "just serve" (no cooking needed); cereal/yogurt default to no-prep
- No-prep items shown in a collapsible section, separated from items that need advance preparation
- Allocation indicators on schedule view: per-meal-field dots showing whether each ingredient is covered by stock (allocated/unallocated/consumed)

## Background Tasks

### Auto-Complete Past Meals
- Every 5 minutes (and once on startup), the server checks for past baby meals that were never marked as consumed
- Any past day (before today in Eastern time) with unconsumed baby meals that have non-empty ingredients is auto-completed
- Uses the same `consumeMeal()` function as the UI — sets the consumed flag and decrements inventory stock atomically
- Configured via `config.autoCompleteIntervalMs` (default: 5 minutes)

## Database Backups

- Uses better-sqlite3's `.backup()` API — safe during concurrent reads/writes
- Backup files stored in `backups/` directory (configurable via `BACKUP_DIR` env var)
- Filename format: `meals-YYYY-MM-DDTHH-MM-SSZ.db` (UTC timestamps)
- **GFS-lite retention**: keeps last 7 daily, 4 weekly, 3 monthly backups (~14 files max)
- Automatic daily backup via `setInterval` (24h), plus startup backup if none exists for today
- Manual trigger via `POST /api/backup` with 5-minute cooldown (returns 429 with `Retry-After`)

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
