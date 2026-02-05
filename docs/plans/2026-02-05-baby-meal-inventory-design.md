# Baby Meal Inventory Feature Design

## Overview

A continuous inventory system for tracking baby meal prep. Users can see what ingredients they have in stock, what's needed over the next few days, and what still needs to be made. Stock is managed through direct adjustments on the inventory page and meal-level "consumed" toggles on the weekly view.

## Data Model

### Modified table: `days`

Three new boolean columns (stored as INTEGER 0/1):

- `baby_breakfast_consumed` INTEGER DEFAULT 0
- `baby_lunch_consumed` INTEGER DEFAULT 0
- `baby_dinner_consumed` INTEGER DEFAULT 0

### New table: `inventory`

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PRIMARY KEY | Auto-increment |
| `ingredient` | TEXT UNIQUE | Normalized: lowercased, trimmed |
| `stock` | INTEGER DEFAULT 0 | Current portions available |

## Stock Mechanics

### How stock changes

- **Increment (+):** User taps "+" on the inventory page after prepping food.
- **Decrement (-):** User taps "-" on the inventory page (e.g., dropped a container, someone else ate it).
- **Consume:** User taps the "consumed" button on a baby meal in the weekly view. Sets the `_consumed` flag to 1 and decrements stock by 1 for each non-empty ingredient in that meal.
- **Unconsume (undo):** User untaps the consumed button. Flag returns to 0, stock increments back for each ingredient.
- **Floor:** Stock can go below 0. This means more was consumed than tracked as made — the "to make" count simply increases.

### Derived values

- **Needed:** Count of ingredient appearances from today through today + N days (configurable: 3, 5, or 7), excluding already-consumed meals.
- **To make:** `max(0, needed - stock)`. The number of portions the user still needs to prep.

### Ingredient normalization

- All matching is case-insensitive and whitespace-trimmed.
- Display name uses the first-seen casing from the meal plan.

## API Endpoints

### Inventory

**`GET /api/inventory?lookahead=7`**

Returns the full inventory view.

- Scans baby meal fields from today through today + N days, crossing week boundaries.
- Groups by normalized ingredient name.
- Joins with `inventory` table for stock counts.
- Excludes consumed meals from the "needed" count.
- Returns: `{ items: [{ ingredient, category, stock, needed, toMake }], lookahead }`
- Also returns items with `stock > 0` that aren't in the lookahead window.

**`PUT /api/inventory/:ingredient`**

Directly update stock for an ingredient.

- Body: `{ "stock": number }` (absolute) or `{ "delta": number }` (relative +/-).
- Upserts into the inventory table.

### Consume/unconsume (extends existing day routes)

**`PUT /api/weeks/:weekOf/days/:day/consume`**

- Body: `{ "meal": "baby_breakfast" | "baby_lunch" | "baby_dinner" }`
- Sets the `_consumed` flag to 1.
- Decrements stock for each non-empty ingredient in that meal.
- Returns updated day record.

**`PUT /api/weeks/:weekOf/days/:day/unconsume`**

- Same body format, reverses the operation.
- Sets flag to 0, increments stock back for each ingredient.

## UI

### Weekly view changes

Each baby meal section (breakfast, lunch, dinner) on each day card gets a "consumed" toggle:

- **Unconsumed:** Subtle outline checkmark button next to the meal header.
- **Consumed:** Filled green checkmark. Meal section gets muted/strikethrough styling.
- Clicking fires the consume/unconsume endpoint and updates stock in the background.

### Inventory page (new)

Accessed via an "Inventory" button in the header alongside existing week navigation.

**Layout:**

1. **Lookahead selector** at the top: toggle between 3 / 5 / 7 days.
2. **Ingredient list** grouped by category (Cereal, Yogurt, Fruit, Vegetable, Meat):
   - Ingredient name
   - Stock count with +/- buttons
   - Needed count
   - "To make" count (highlighted when > 0)
3. **Color coding:**
   - `toMake > 0`: amber/orange highlight (action needed)
   - `stock >= needed`: green (good to go)
4. **"Other stock" section** at the bottom for ingredients with stock > 0 that don't appear in the lookahead window.
5. **Empty state:** "No baby meals planned for the next N days" when no meals exist in the lookahead.

**Navigation:** Same header/layout as weekly view. Tab-style toggle between "Meal Plan" and "Inventory."

## Edge Cases

### Editing a meal after consumption

If a meal is marked consumed and the user edits an ingredient, the stock adjustment from the original consumption is NOT automatically reversed. To correct: unconsume, edit, re-consume. The consumed flag persists across edits.

### Week deletion

When a week is deleted, consumed flags are removed via CASCADE. Stock in the inventory table is NOT adjusted — it represents physical food regardless of plan changes.

### New weeks / empty plans

The inventory page works with no meals planned. It shows items with stock > 0 (if any) and zeros in the "needed" column.
