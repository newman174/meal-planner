# Baby Meal Inventory Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a continuous baby meal inventory system that tracks ingredient stock, derives needed counts from upcoming meal plans, and lets users mark meals as consumed.

**Architecture:** Three layers of change: (1) database schema additions — new `inventory` table + 3 consumed columns on `days`, (2) backend API — inventory CRUD + consume/unconsume endpoints + lookahead query logic, (3) frontend — consumed toggles on day cards + new inventory page with stock management.

**Tech Stack:** TypeScript/Express backend, SQLite (better-sqlite3), vanilla JS frontend, Vitest tests.

---

### Task 1: Database Schema — Add consumed columns to `days` table

**Files:**
- Modify: `src/db.ts:55-126` (initSchema function)
- Modify: `src/types/index.ts:15-30` (DayRecord interface)
- Modify: `tests/helpers/db-test-helper.ts:18-45` (createTestDb schema)

**Step 1: Write failing test**

Create file: `tests/integration/inventory-db.test.ts`

```typescript
/**
 * @fileoverview Integration tests for inventory database operations
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDb, insertTestWeek, updateTestDay } from '../helpers/db-test-helper.js';
import { getWeek } from '../../src/db.js';
import type Database from 'better-sqlite3';

describe('Inventory Database Schema', () => {
  let db: Database.Database;
  let cleanup: () => void;

  beforeEach(() => {
    const testSetup = setupTestDb();
    db = testSetup.db;
    cleanup = testSetup.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  describe('consumed columns on days table', () => {
    it('days table has consumed columns with default 0', () => {
      insertTestWeek(db, '2025-01-06');
      const week = getWeek('2025-01-06');
      const monday = week?.days[0];

      expect(monday).toHaveProperty('baby_breakfast_consumed', 0);
      expect(monday).toHaveProperty('baby_lunch_consumed', 0);
      expect(monday).toHaveProperty('baby_dinner_consumed', 0);
    });
  });

  describe('inventory table', () => {
    it('inventory table exists and accepts inserts', () => {
      db.prepare('INSERT INTO inventory (ingredient, stock) VALUES (?, ?)').run('chicken', 3);
      const row = db.prepare('SELECT * FROM inventory WHERE ingredient = ?').get('chicken') as { ingredient: string; stock: number };

      expect(row.ingredient).toBe('chicken');
      expect(row.stock).toBe(3);
    });

    it('enforces unique ingredient constraint', () => {
      db.prepare('INSERT INTO inventory (ingredient, stock) VALUES (?, ?)').run('peas', 2);

      expect(() => {
        db.prepare('INSERT INTO inventory (ingredient, stock) VALUES (?, ?)').run('peas', 5);
      }).toThrow();
    });

    it('defaults stock to 0', () => {
      db.prepare('INSERT INTO inventory (ingredient) VALUES (?)').run('banana');
      const row = db.prepare('SELECT stock FROM inventory WHERE ingredient = ?').get('banana') as { stock: number };

      expect(row.stock).toBe(0);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/integration/inventory-db.test.ts`
Expected: FAIL — `baby_breakfast_consumed` property missing, `inventory` table doesn't exist.

**Step 3: Update types — add consumed fields to DayRecord**

In `src/types/index.ts`, add to the `DayRecord` interface (after the `note` field on line 29):

```typescript
  baby_breakfast_consumed: number;
  baby_lunch_consumed: number;
  baby_dinner_consumed: number;
```

**Step 4: Update production schema — add consumed columns + inventory table**

In `src/db.ts`, inside `initSchema()`, after the existing schema creation (after line 85 closing `);`), add a migration for consumed columns:

```typescript
  // Add consumed columns to days table (inventory feature)
  const daysCols = (db.pragma('table_info(days)') as ColumnInfo[]).map(c => c.name);
  if (!daysCols.includes('baby_breakfast_consumed')) {
    db.exec(`
      ALTER TABLE days ADD COLUMN baby_breakfast_consumed INTEGER DEFAULT 0;
      ALTER TABLE days ADD COLUMN baby_lunch_consumed INTEGER DEFAULT 0;
      ALTER TABLE days ADD COLUMN baby_dinner_consumed INTEGER DEFAULT 0;
    `);
    logger.info('Added consumed columns to days table');
  }

  // Create inventory table
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ingredient TEXT UNIQUE NOT NULL,
      stock INTEGER DEFAULT 0
    );
  `);
```

**Step 5: Update test helper schema**

In `tests/helpers/db-test-helper.ts`, add the consumed columns to the `days` CREATE TABLE (after `note TEXT DEFAULT ''`):

```sql
      baby_breakfast_consumed INTEGER DEFAULT 0,
      baby_lunch_consumed INTEGER DEFAULT 0,
      baby_dinner_consumed INTEGER DEFAULT 0,
```

And add after the days table creation:

```sql
    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ingredient TEXT UNIQUE NOT NULL,
      stock INTEGER DEFAULT 0
    );
```

**Step 6: Run test to verify it passes**

Run: `npm test -- tests/integration/inventory-db.test.ts`
Expected: PASS

**Step 7: Run all existing tests to verify no regressions**

Run: `npm test`
Expected: All tests PASS

**Step 8: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (no type errors)

**Step 9: Commit**

```bash
git add src/db.ts src/types/index.ts tests/helpers/db-test-helper.ts tests/integration/inventory-db.test.ts
git commit -m "feat(inventory): add consumed columns and inventory table schema"
```

---

### Task 2: Backend — Inventory database functions

**Files:**
- Modify: `src/db.ts` (add new exported functions)
- Modify: `src/types/index.ts` (add inventory types)
- Test: `tests/integration/inventory-db.test.ts` (extend)

**Step 1: Add inventory types**

In `src/types/index.ts`, add after the `CopyWeekRequest` interface:

```typescript
/** A single item in the inventory view */
export interface InventoryItem {
  ingredient: string;
  displayName: string;
  category: string;
  stock: number;
  needed: number;
  toMake: number;
}

/** Response from GET /api/inventory */
export interface InventoryResponse {
  items: InventoryItem[];
  otherStock: InventoryItem[];
  lookahead: number;
}

/** Valid baby meal types for consume/unconsume */
export type BabyMealType = 'baby_breakfast' | 'baby_lunch' | 'baby_dinner';
```

**Step 2: Write failing tests for inventory db functions**

Append to `tests/integration/inventory-db.test.ts`:

```typescript
import {
  getWeek,
  getInventory,
  updateStock,
  consumeMeal,
  unconsumeMeal,
} from '../../src/db.js';

// ... inside the main describe block, add:

  describe('getInventory', () => {
    it('returns empty items when no meals planned', () => {
      const result = getInventory(7, '2025-01-06');
      expect(result.items).toEqual([]);
      expect(result.otherStock).toEqual([]);
    });

    it('aggregates ingredients from upcoming days', () => {
      // Create a week starting 2025-01-06 (Monday)
      const weekId = insertTestWeek(db, '2025-01-06');
      updateTestDay(db, weekId, 0, { baby_lunch_meat: 'chicken', baby_lunch_vegetable: 'peas' });
      updateTestDay(db, weekId, 1, { baby_lunch_meat: 'chicken', baby_dinner_meat: 'beef' });

      // Look ahead 7 days from Monday 2025-01-06
      const result = getInventory(7, '2025-01-06');

      const chicken = result.items.find(i => i.ingredient === 'chicken');
      expect(chicken).toBeDefined();
      expect(chicken!.needed).toBe(2);
      expect(chicken!.stock).toBe(0);
      expect(chicken!.toMake).toBe(2);

      const peas = result.items.find(i => i.ingredient === 'peas');
      expect(peas!.needed).toBe(1);

      const beef = result.items.find(i => i.ingredient === 'beef');
      expect(beef!.needed).toBe(1);
    });

    it('excludes consumed meals from needed count', () => {
      const weekId = insertTestWeek(db, '2025-01-06');
      updateTestDay(db, weekId, 0, { baby_lunch_meat: 'chicken' });
      updateTestDay(db, weekId, 1, { baby_lunch_meat: 'chicken' });
      // Mark Monday lunch as consumed
      db.prepare('UPDATE days SET baby_lunch_consumed = 1 WHERE week_id = ? AND day = 0').run(weekId);

      const result = getInventory(7, '2025-01-06');
      const chicken = result.items.find(i => i.ingredient === 'chicken');
      expect(chicken!.needed).toBe(1); // Only Tuesday's is counted
    });

    it('includes stock in toMake calculation', () => {
      const weekId = insertTestWeek(db, '2025-01-06');
      updateTestDay(db, weekId, 0, { baby_lunch_meat: 'chicken' });
      updateTestDay(db, weekId, 1, { baby_lunch_meat: 'chicken' });
      db.prepare('INSERT INTO inventory (ingredient, stock) VALUES (?, ?)').run('chicken', 1);

      const result = getInventory(7, '2025-01-06');
      const chicken = result.items.find(i => i.ingredient === 'chicken');
      expect(chicken!.stock).toBe(1);
      expect(chicken!.needed).toBe(2);
      expect(chicken!.toMake).toBe(1); // max(0, 2 - 1)
    });

    it('shows items with stock not in lookahead as otherStock', () => {
      db.prepare('INSERT INTO inventory (ingredient, stock) VALUES (?, ?)').run('turkey', 3);

      const result = getInventory(7, '2025-01-06');
      expect(result.items).toEqual([]);
      expect(result.otherStock).toHaveLength(1);
      expect(result.otherStock[0].ingredient).toBe('turkey');
      expect(result.otherStock[0].stock).toBe(3);
    });

    it('normalizes ingredient names case-insensitively', () => {
      const weekId = insertTestWeek(db, '2025-01-06');
      updateTestDay(db, weekId, 0, { baby_lunch_meat: 'Chicken' });
      updateTestDay(db, weekId, 1, { baby_dinner_meat: 'chicken' });

      const result = getInventory(7, '2025-01-06');
      const chickenItems = result.items.filter(i => i.ingredient === 'chicken');
      expect(chickenItems).toHaveLength(1);
      expect(chickenItems[0].needed).toBe(2);
      expect(chickenItems[0].displayName).toBe('Chicken'); // First-seen casing
    });

    it('assigns correct categories', () => {
      const weekId = insertTestWeek(db, '2025-01-06');
      updateTestDay(db, weekId, 0, {
        baby_breakfast_cereal: 'oats',
        baby_breakfast_yogurt: 'plain',
        baby_breakfast_fruit: 'banana',
        baby_lunch_meat: 'chicken',
        baby_lunch_vegetable: 'peas',
      });

      const result = getInventory(7, '2025-01-06');
      expect(result.items.find(i => i.ingredient === 'oats')!.category).toBe('cereal');
      expect(result.items.find(i => i.ingredient === 'plain')!.category).toBe('yogurt');
      expect(result.items.find(i => i.ingredient === 'banana')!.category).toBe('fruit');
      expect(result.items.find(i => i.ingredient === 'chicken')!.category).toBe('meat');
      expect(result.items.find(i => i.ingredient === 'peas')!.category).toBe('vegetable');
    });

    it('crosses week boundaries for lookahead', () => {
      // Sunday is day 6 of week 2025-01-06
      const weekId1 = insertTestWeek(db, '2025-01-06');
      updateTestDay(db, weekId1, 6, { baby_lunch_meat: 'chicken' }); // Sunday Jan 12

      // Monday is day 0 of week 2025-01-13
      const weekId2 = insertTestWeek(db, '2025-01-13');
      updateTestDay(db, weekId2, 0, { baby_lunch_meat: 'chicken' }); // Monday Jan 13

      // Look ahead 7 days from Saturday Jan 11 (day 5 of week 1)
      const result = getInventory(7, '2025-01-11');
      const chicken = result.items.find(i => i.ingredient === 'chicken');
      expect(chicken!.needed).toBe(2); // Sunday + Monday
    });
  });

  describe('updateStock', () => {
    it('creates new inventory row with absolute stock', () => {
      updateStock('chicken', { stock: 5 });
      const row = db.prepare('SELECT * FROM inventory WHERE ingredient = ?').get('chicken') as { stock: number };
      expect(row.stock).toBe(5);
    });

    it('updates existing stock with absolute value', () => {
      db.prepare('INSERT INTO inventory (ingredient, stock) VALUES (?, ?)').run('chicken', 3);
      updateStock('chicken', { stock: 5 });
      const row = db.prepare('SELECT stock FROM inventory WHERE ingredient = ?').get('chicken') as { stock: number };
      expect(row.stock).toBe(5);
    });

    it('applies delta to existing stock', () => {
      db.prepare('INSERT INTO inventory (ingredient, stock) VALUES (?, ?)').run('chicken', 3);
      updateStock('chicken', { delta: 2 });
      const row = db.prepare('SELECT stock FROM inventory WHERE ingredient = ?').get('chicken') as { stock: number };
      expect(row.stock).toBe(5);
    });

    it('applies delta to non-existent ingredient (starts from 0)', () => {
      updateStock('peas', { delta: -1 });
      const row = db.prepare('SELECT stock FROM inventory WHERE ingredient = ?').get('peas') as { stock: number };
      expect(row.stock).toBe(-1);
    });

    it('normalizes ingredient name', () => {
      updateStock('  Chicken  ', { stock: 5 });
      const row = db.prepare('SELECT * FROM inventory WHERE ingredient = ?').get('chicken') as { ingredient: string; stock: number };
      expect(row.ingredient).toBe('chicken');
      expect(row.stock).toBe(5);
    });
  });

  describe('consumeMeal / unconsumeMeal', () => {
    it('consumeMeal sets flag and decrements stock', () => {
      const weekId = insertTestWeek(db, '2025-01-06');
      updateTestDay(db, weekId, 0, { baby_lunch_meat: 'chicken', baby_lunch_vegetable: 'peas', baby_lunch_fruit: 'apple' });
      db.prepare('INSERT INTO inventory (ingredient, stock) VALUES (?, ?)').run('chicken', 3);
      db.prepare('INSERT INTO inventory (ingredient, stock) VALUES (?, ?)').run('peas', 2);
      db.prepare('INSERT INTO inventory (ingredient, stock) VALUES (?, ?)').run('apple', 1);

      consumeMeal('2025-01-06', 0, 'baby_lunch');

      // Check consumed flag
      const week = getWeek('2025-01-06');
      expect(week?.days[0].baby_lunch_consumed).toBe(1);

      // Check stock decremented
      const chicken = db.prepare('SELECT stock FROM inventory WHERE ingredient = ?').get('chicken') as { stock: number };
      expect(chicken.stock).toBe(2);
      const peas = db.prepare('SELECT stock FROM inventory WHERE ingredient = ?').get('peas') as { stock: number };
      expect(peas.stock).toBe(1);
      const apple = db.prepare('SELECT stock FROM inventory WHERE ingredient = ?').get('apple') as { stock: number };
      expect(apple.stock).toBe(0);
    });

    it('consumeMeal creates inventory rows if they do not exist', () => {
      const weekId = insertTestWeek(db, '2025-01-06');
      updateTestDay(db, weekId, 0, { baby_lunch_meat: 'chicken' });

      consumeMeal('2025-01-06', 0, 'baby_lunch');

      const row = db.prepare('SELECT stock FROM inventory WHERE ingredient = ?').get('chicken') as { stock: number };
      expect(row.stock).toBe(-1); // 0 - 1 = -1
    });

    it('consumeMeal skips empty fields', () => {
      const weekId = insertTestWeek(db, '2025-01-06');
      updateTestDay(db, weekId, 0, { baby_lunch_meat: 'chicken' });
      // baby_lunch_vegetable and baby_lunch_fruit are empty

      consumeMeal('2025-01-06', 0, 'baby_lunch');

      const rows = db.prepare('SELECT * FROM inventory').all();
      expect(rows).toHaveLength(1); // Only chicken
    });

    it('consumeMeal is idempotent (does not double-decrement)', () => {
      const weekId = insertTestWeek(db, '2025-01-06');
      updateTestDay(db, weekId, 0, { baby_lunch_meat: 'chicken' });
      db.prepare('INSERT INTO inventory (ingredient, stock) VALUES (?, ?)').run('chicken', 3);

      consumeMeal('2025-01-06', 0, 'baby_lunch');
      consumeMeal('2025-01-06', 0, 'baby_lunch'); // Second call

      const row = db.prepare('SELECT stock FROM inventory WHERE ingredient = ?').get('chicken') as { stock: number };
      expect(row.stock).toBe(2); // Only decremented once
    });

    it('unconsumeMeal clears flag and increments stock', () => {
      const weekId = insertTestWeek(db, '2025-01-06');
      updateTestDay(db, weekId, 0, { baby_lunch_meat: 'chicken', baby_lunch_vegetable: 'peas' });
      db.prepare('INSERT INTO inventory (ingredient, stock) VALUES (?, ?)').run('chicken', 2);
      db.prepare('INSERT INTO inventory (ingredient, stock) VALUES (?, ?)').run('peas', 1);

      // First consume, then unconsume
      consumeMeal('2025-01-06', 0, 'baby_lunch');
      unconsumeMeal('2025-01-06', 0, 'baby_lunch');

      const week = getWeek('2025-01-06');
      expect(week?.days[0].baby_lunch_consumed).toBe(0);

      const chicken = db.prepare('SELECT stock FROM inventory WHERE ingredient = ?').get('chicken') as { stock: number };
      expect(chicken.stock).toBe(2); // Back to original
    });

    it('unconsumeMeal is idempotent (does not double-increment)', () => {
      const weekId = insertTestWeek(db, '2025-01-06');
      updateTestDay(db, weekId, 0, { baby_lunch_meat: 'chicken' });
      db.prepare('INSERT INTO inventory (ingredient, stock) VALUES (?, ?)').run('chicken', 3);

      // Consume, then unconsume twice
      consumeMeal('2025-01-06', 0, 'baby_lunch');
      unconsumeMeal('2025-01-06', 0, 'baby_lunch');
      unconsumeMeal('2025-01-06', 0, 'baby_lunch'); // Second call

      const row = db.prepare('SELECT stock FROM inventory WHERE ingredient = ?').get('chicken') as { stock: number };
      expect(row.stock).toBe(3); // Back to original, not 4
    });
  });
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/integration/inventory-db.test.ts`
Expected: FAIL — functions don't exist yet.

**Step 3: Implement inventory db functions in `src/db.ts`**

Add these constants after `ALLOWED_DAY_FIELDS` (after line 152):

```typescript
/** Maps baby meal field name prefixes to their sub-fields */
const BABY_MEAL_FIELDS: Record<string, { fields: string[]; category: Record<string, string> }> = {
  baby_breakfast: {
    fields: ['baby_breakfast_cereal', 'baby_breakfast_yogurt', 'baby_breakfast_fruit'],
    category: { baby_breakfast_cereal: 'cereal', baby_breakfast_yogurt: 'yogurt', baby_breakfast_fruit: 'fruit' }
  },
  baby_lunch: {
    fields: ['baby_lunch_meat', 'baby_lunch_vegetable', 'baby_lunch_fruit'],
    category: { baby_lunch_meat: 'meat', baby_lunch_vegetable: 'vegetable', baby_lunch_fruit: 'fruit' }
  },
  baby_dinner: {
    fields: ['baby_dinner_meat', 'baby_dinner_vegetable', 'baby_dinner_fruit'],
    category: { baby_dinner_meat: 'meat', baby_dinner_vegetable: 'vegetable', baby_dinner_fruit: 'fruit' }
  },
};

/** All baby meal field keys for scanning */
const ALL_BABY_FIELDS = Object.values(BABY_MEAL_FIELDS).flatMap(m => m.fields);

/** Category lookup: field name → category */
const FIELD_CATEGORY: Record<string, string> = {};
for (const meal of Object.values(BABY_MEAL_FIELDS)) {
  Object.assign(FIELD_CATEGORY, meal.category);
}
```

Add import for `InventoryItem`, `InventoryResponse`, `BabyMealType` in the import block at the top.

Add these functions before the `closeDb` function:

```typescript
/**
 * Normalizes an ingredient name for consistent storage and lookup.
 */
function normalizeIngredient(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Gets the inventory view: ingredients needed in the lookahead window,
 * their stock levels, and items with stock not in the window.
 * @param lookahead - Number of days to look ahead (3, 5, or 7)
 * @param todayOverride - Override today's date for testing (YYYY-MM-DD)
 */
function getInventory(lookahead: number, todayOverride?: string): InventoryResponse {
  const database = getDb();

  // Get upcoming days' raw data (reuse existing getUpcomingDays logic but we need raw DayRecords)
  const today = todayOverride
    ? new Date(todayOverride + 'T12:00:00')
    : getEasternNow();

  // Collect day records for the lookahead window
  const dayRecords: DayRecord[] = [];
  const weekOfsNeeded = new Set<string>();

  for (let i = 0; i < lookahead; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const weekOf = getMonday(d);
    if (weekOf) weekOfsNeeded.add(weekOf);
  }

  // Fetch all needed weeks
  const weeksCache: Record<string, WeekWithDays | null> = {};
  for (const weekOf of weekOfsNeeded) {
    weeksCache[weekOf] = getWeek(weekOf);
  }

  // Collect matching day records
  for (let i = 0; i < lookahead; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const weekOf = getMonday(d);
    const dow = d.getDay();
    const dayIndex = dow === 0 ? 6 : dow - 1;

    const week = weekOf ? weeksCache[weekOf] : null;
    const dayData = week?.days.find(r => r.day === dayIndex);
    if (dayData) dayRecords.push(dayData);
  }

  // Aggregate ingredients from non-consumed meals
  const ingredientMap = new Map<string, { displayName: string; category: string; needed: number }>();

  for (const day of dayRecords) {
    for (const [mealType, mealConfig] of Object.entries(BABY_MEAL_FIELDS)) {
      const consumedKey = `${mealType}_consumed` as keyof DayRecord;
      if (day[consumedKey]) continue; // Skip consumed meals

      for (const field of mealConfig.fields) {
        const value = day[field as keyof DayRecord] as string;
        if (!value || !value.trim()) continue;

        const normalized = normalizeIngredient(value);
        const existing = ingredientMap.get(normalized);
        if (existing) {
          existing.needed++;
        } else {
          ingredientMap.set(normalized, {
            displayName: value.trim(),
            category: mealConfig.category[field],
            needed: 1,
          });
        }
      }
    }
  }

  // Get all inventory rows
  const allStock = database.prepare('SELECT ingredient, stock FROM inventory').all() as { ingredient: string; stock: number }[];
  const stockMap = new Map(allStock.map(r => [r.ingredient, r.stock]));

  // Build items array
  const items: InventoryItem[] = [];
  for (const [ingredient, data] of ingredientMap) {
    const stock = stockMap.get(ingredient) || 0;
    items.push({
      ingredient,
      displayName: data.displayName,
      category: data.category,
      stock,
      needed: data.needed,
      toMake: Math.max(0, data.needed - stock),
    });
  }

  // Build otherStock: items with stock > 0 not in the lookahead
  const otherStock: InventoryItem[] = [];
  for (const [ingredient, stock] of stockMap) {
    if (stock > 0 && !ingredientMap.has(ingredient)) {
      otherStock.push({
        ingredient,
        displayName: ingredient, // No meal plan reference, use normalized
        category: '',
        stock,
        needed: 0,
        toMake: 0,
      });
    }
  }

  return { items, otherStock, lookahead };
}

/**
 * Updates stock for an ingredient.
 * @param ingredient - Raw ingredient name (will be normalized)
 * @param update - Either { stock: number } for absolute or { delta: number } for relative
 */
function updateStock(ingredient: string, update: { stock?: number; delta?: number }): void {
  const database = getDb();
  const normalized = normalizeIngredient(ingredient);

  if (update.stock !== undefined) {
    database.prepare(
      'INSERT INTO inventory (ingredient, stock) VALUES (?, ?) ON CONFLICT(ingredient) DO UPDATE SET stock = excluded.stock'
    ).run(normalized, update.stock);
  } else if (update.delta !== undefined) {
    database.prepare(
      'INSERT INTO inventory (ingredient, stock) VALUES (?, ?) ON CONFLICT(ingredient) DO UPDATE SET stock = stock + ?'
    ).run(normalized, update.delta, update.delta);
  }
}

/**
 * Marks a baby meal as consumed and decrements stock for its ingredients.
 * Idempotent — if already consumed, does nothing.
 */
function consumeMeal(weekOf: string, dayIndex: number, mealType: string): DayRecord | null {
  const database = getDb();
  const week = getWeek(weekOf);
  if (!week) return null;

  const day = week.days.find(d => d.day === dayIndex);
  if (!day) return null;

  const consumedKey = `${mealType}_consumed` as keyof DayRecord;
  if (day[consumedKey]) return day; // Already consumed, idempotent

  const mealConfig = BABY_MEAL_FIELDS[mealType];
  if (!mealConfig) return null;

  const consumeTransaction = database.transaction(() => {
    // Set consumed flag
    database.prepare(
      `UPDATE days SET ${mealType}_consumed = 1 WHERE week_id = ? AND day = ?`
    ).run(week.id, dayIndex);

    // Decrement stock for each non-empty ingredient
    for (const field of mealConfig.fields) {
      const value = day[field as keyof DayRecord] as string;
      if (!value || !value.trim()) continue;
      const normalized = normalizeIngredient(value);
      database.prepare(
        'INSERT INTO inventory (ingredient, stock) VALUES (?, -1) ON CONFLICT(ingredient) DO UPDATE SET stock = stock - 1'
      ).run(normalized);
    }
  });

  consumeTransaction();

  // Return updated day
  const updatedWeek = getWeek(weekOf);
  return updatedWeek?.days.find(d => d.day === dayIndex) || null;
}

/**
 * Unmarks a baby meal as consumed and increments stock for its ingredients.
 * Idempotent — if not consumed, does nothing.
 */
function unconsumeMeal(weekOf: string, dayIndex: number, mealType: string): DayRecord | null {
  const database = getDb();
  const week = getWeek(weekOf);
  if (!week) return null;

  const day = week.days.find(d => d.day === dayIndex);
  if (!day) return null;

  const consumedKey = `${mealType}_consumed` as keyof DayRecord;
  if (!day[consumedKey]) return day; // Not consumed, idempotent

  const mealConfig = BABY_MEAL_FIELDS[mealType];
  if (!mealConfig) return null;

  const unconsumeTransaction = database.transaction(() => {
    // Clear consumed flag
    database.prepare(
      `UPDATE days SET ${mealType}_consumed = 0 WHERE week_id = ? AND day = ?`
    ).run(week.id, dayIndex);

    // Increment stock for each non-empty ingredient
    for (const field of mealConfig.fields) {
      const value = day[field as keyof DayRecord] as string;
      if (!value || !value.trim()) continue;
      const normalized = normalizeIngredient(value);
      database.prepare(
        'INSERT INTO inventory (ingredient, stock) VALUES (?, 1) ON CONFLICT(ingredient) DO UPDATE SET stock = stock + 1'
      ).run(normalized);
    }
  });

  unconsumeTransaction();

  // Return updated day
  const updatedWeek = getWeek(weekOf);
  return updatedWeek?.days.find(d => d.day === dayIndex) || null;
}
```

Update the exports at the bottom of `src/db.ts` to include the new functions:

```typescript
export {
  // ... existing exports ...
  getInventory,
  updateStock,
  consumeMeal,
  unconsumeMeal,
  BABY_MEAL_FIELDS,
};
```

**Step 4: Run inventory tests**

Run: `npm test -- tests/integration/inventory-db.test.ts`
Expected: PASS

**Step 5: Run all tests**

Run: `npm test`
Expected: All PASS

**Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 7: Commit**

```bash
git add src/db.ts src/types/index.ts tests/integration/inventory-db.test.ts
git commit -m "feat(inventory): add inventory db functions — getInventory, updateStock, consumeMeal, unconsumeMeal"
```

---

### Task 3: Backend — API endpoints for inventory

**Files:**
- Modify: `src/server.ts` (add new routes)
- Test: `tests/integration/api.test.ts` (extend)

**Step 1: Write failing API tests**

Append to `tests/integration/api.test.ts`, inside the main describe block:

```typescript
  describe('GET /api/inventory', () => {
    it('returns empty inventory with no meals planned', async () => {
      const res = await client.get('/api/inventory?lookahead=7');

      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
      expect(res.body.otherStock).toEqual([]);
      expect(res.body.lookahead).toBe(7);
    });

    it('returns inventory with planned meals', async () => {
      const weekId = insertTestWeek(db, '2025-01-06');
      updateTestDay(db, weekId, 0, { baby_lunch_meat: 'chicken' });

      const res = await client.get('/api/inventory?lookahead=7&today=2025-01-06');

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].ingredient).toBe('chicken');
      expect(res.body.items[0].needed).toBe(1);
    });

    it('defaults lookahead to 7', async () => {
      const res = await client.get('/api/inventory');

      expect(res.status).toBe(200);
      expect(res.body.lookahead).toBe(7);
    });

    it('rejects invalid lookahead values', async () => {
      const res = await client.get('/api/inventory?lookahead=10');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('lookahead');
    });
  });

  describe('PUT /api/inventory/:ingredient', () => {
    it('sets absolute stock', async () => {
      const res = await client
        .put('/api/inventory/chicken')
        .send({ stock: 5 });

      expect(res.status).toBe(200);
      expect(res.body.ingredient).toBe('chicken');
      expect(res.body.stock).toBe(5);
    });

    it('applies delta to stock', async () => {
      // First set stock
      await client.put('/api/inventory/chicken').send({ stock: 3 });

      const res = await client
        .put('/api/inventory/chicken')
        .send({ delta: 2 });

      expect(res.status).toBe(200);
      expect(res.body.stock).toBe(5);
    });

    it('returns 400 when neither stock nor delta provided', async () => {
      const res = await client
        .put('/api/inventory/chicken')
        .send({});

      expect(res.status).toBe(400);
    });

    it('normalizes ingredient name', async () => {
      const res = await client
        .put('/api/inventory/%20Chicken%20')
        .send({ stock: 5 });

      expect(res.status).toBe(200);
      expect(res.body.ingredient).toBe('chicken');
    });
  });

  describe('PUT /api/weeks/:weekOf/days/:day/consume', () => {
    it('marks meal as consumed and returns updated day', async () => {
      const weekId = insertTestWeek(db, '2025-01-06');
      updateTestDay(db, weekId, 0, { baby_lunch_meat: 'chicken' });

      const res = await client
        .put('/api/weeks/2025-01-06/days/0/consume')
        .send({ meal: 'baby_lunch' });

      expect(res.status).toBe(200);
      expect(res.body.baby_lunch_consumed).toBe(1);
    });

    it('returns 400 for invalid meal type', async () => {
      insertTestWeek(db, '2025-01-06');

      const res = await client
        .put('/api/weeks/2025-01-06/days/0/consume')
        .send({ meal: 'adult_dinner' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('meal');
    });

    it('returns 400 for missing meal field', async () => {
      insertTestWeek(db, '2025-01-06');

      const res = await client
        .put('/api/weeks/2025-01-06/days/0/consume')
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('PUT /api/weeks/:weekOf/days/:day/unconsume', () => {
    it('unmarks meal as consumed', async () => {
      const weekId = insertTestWeek(db, '2025-01-06');
      updateTestDay(db, weekId, 0, { baby_lunch_meat: 'chicken' });

      // Consume first
      await client
        .put('/api/weeks/2025-01-06/days/0/consume')
        .send({ meal: 'baby_lunch' });

      // Then unconsume
      const res = await client
        .put('/api/weeks/2025-01-06/days/0/unconsume')
        .send({ meal: 'baby_lunch' });

      expect(res.status).toBe(200);
      expect(res.body.baby_lunch_consumed).toBe(0);
    });
  });
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/integration/api.test.ts`
Expected: FAIL — routes don't exist yet.

**Step 3: Add API routes to `src/server.ts`**

Add after the existing app API routes (before the `// --- Public API routes ---` comment on line 261), importing `BabyMealType` from types:

```typescript
// --- Inventory API routes ---

const VALID_LOOKAHEADS = [3, 5, 7];
const VALID_MEAL_TYPES = ['baby_breakfast', 'baby_lunch', 'baby_dinner'];

/**
 * GET /api/inventory
 * Returns inventory items with needed counts and stock levels.
 */
app.get('/api/inventory', (req: Request, res: Response) => {
  try {
    const lookaheadParam = parseInt(req.query.lookahead as string, 10) || 7;
    if (!VALID_LOOKAHEADS.includes(lookaheadParam)) {
      res.status(400).json({ error: 'Invalid lookahead. Must be 3, 5, or 7.' });
      return;
    }

    const todayOverride = req.query.today as string | undefined;
    const result = db.getInventory(lookaheadParam, todayOverride);
    res.json(result);
  } catch (err) {
    logger.error({ err }, 'Error fetching inventory');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/inventory/:ingredient
 * Updates stock for an ingredient (absolute or delta).
 */
app.put('/api/inventory/:ingredient', requireApiKey, (req: Request<{ ingredient: string }>, res: Response) => {
  try {
    if (!isValidRequestBody(req.body)) {
      res.status(400).json({ error: 'Invalid request body.' });
      return;
    }

    const { stock, delta } = req.body as { stock?: number; delta?: number };
    if (stock === undefined && delta === undefined) {
      res.status(400).json({ error: 'Provide either "stock" (absolute) or "delta" (relative).' });
      return;
    }

    if (stock !== undefined && typeof stock !== 'number') {
      res.status(400).json({ error: '"stock" must be a number.' });
      return;
    }
    if (delta !== undefined && typeof delta !== 'number') {
      res.status(400).json({ error: '"delta" must be a number.' });
      return;
    }

    const ingredient = decodeURIComponent(req.params.ingredient).trim().toLowerCase();
    db.updateStock(ingredient, { stock, delta });

    const database = db.getDb();
    const row = database.prepare('SELECT ingredient, stock FROM inventory WHERE ingredient = ?').get(ingredient) as { ingredient: string; stock: number } | undefined;
    res.json(row || { ingredient, stock: 0 });
  } catch (err) {
    logger.error({ err, ingredient: req.params.ingredient }, 'Error updating inventory');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/weeks/:weekOf/days/:day/consume
 * Marks a baby meal as consumed and decrements ingredient stock.
 */
app.put('/api/weeks/:weekOf/days/:day/consume', requireApiKey, (req: Request<{ weekOf: string; day: string }>, res: Response) => {
  try {
    if (!isValidWeekOf(req.params.weekOf)) {
      res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
      return;
    }
    if (!isValidRequestBody(req.body)) {
      res.status(400).json({ error: 'Invalid request body.' });
      return;
    }

    const dayIndex = parseInt(req.params.day, 10);
    if (isNaN(dayIndex) || dayIndex < 0 || dayIndex > 6) {
      res.status(400).json({ error: 'Invalid day index (0-6)' });
      return;
    }

    const meal = (req.body as Record<string, unknown>).meal as string;
    if (!meal || !VALID_MEAL_TYPES.includes(meal)) {
      res.status(400).json({ error: 'Invalid meal. Must be baby_breakfast, baby_lunch, or baby_dinner.' });
      return;
    }

    const result = db.consumeMeal(req.params.weekOf, dayIndex, meal);
    if (!result) {
      res.status(404).json({ error: 'Day not found' });
      return;
    }
    res.json(result);
  } catch (err) {
    logger.error({ err }, 'Error consuming meal');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/weeks/:weekOf/days/:day/unconsume
 * Unmarks a baby meal as consumed and increments ingredient stock.
 */
app.put('/api/weeks/:weekOf/days/:day/unconsume', requireApiKey, (req: Request<{ weekOf: string; day: string }>, res: Response) => {
  try {
    if (!isValidWeekOf(req.params.weekOf)) {
      res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
      return;
    }
    if (!isValidRequestBody(req.body)) {
      res.status(400).json({ error: 'Invalid request body.' });
      return;
    }

    const dayIndex = parseInt(req.params.day, 10);
    if (isNaN(dayIndex) || dayIndex < 0 || dayIndex > 6) {
      res.status(400).json({ error: 'Invalid day index (0-6)' });
      return;
    }

    const meal = (req.body as Record<string, unknown>).meal as string;
    if (!meal || !VALID_MEAL_TYPES.includes(meal)) {
      res.status(400).json({ error: 'Invalid meal. Must be baby_breakfast, baby_lunch, or baby_dinner.' });
      return;
    }

    const result = db.unconsumeMeal(req.params.weekOf, dayIndex, meal);
    if (!result) {
      res.status(404).json({ error: 'Day not found' });
      return;
    }
    res.json(result);
  } catch (err) {
    logger.error({ err }, 'Error unconsuming meal');
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

**Step 4: Run API tests**

Run: `npm test -- tests/integration/api.test.ts`
Expected: PASS

**Step 5: Run all tests**

Run: `npm test`
Expected: All PASS

**Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 7: Commit**

```bash
git add src/server.ts tests/integration/api.test.ts
git commit -m "feat(inventory): add inventory API endpoints — GET/PUT inventory, consume/unconsume meals"
```

---

### Task 4: Frontend — Add consumed toggle buttons to weekly view

**Files:**
- Modify: `public/app.js` (add consume toggle to createMealSection)
- Modify: `public/style.css` (add consumed styling)

**Step 1: Add CSS for consumed toggle**

Append to `public/style.css`:

```css
/* ── Consumed toggle ── */
.consume-toggle {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid var(--border-input);
  background: transparent;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  color: var(--text-muted);
  box-shadow: none;
  transition: all 0.2s ease;
  cursor: pointer;
  flex-shrink: 0;
}

.consume-toggle:hover {
  border-color: var(--save-color);
  color: var(--save-color);
  background: transparent;
  box-shadow: none;
  transform: none;
}

.consume-toggle.consumed {
  background: var(--save-color);
  border-color: var(--save-color);
  color: white;
}

.consume-toggle.consumed:hover {
  background: #059669;
  border-color: #059669;
  color: white;
}

.meal-section.consumed-meal .meal-fields input {
  opacity: 0.5;
  text-decoration: line-through;
}

.meal-section.consumed-meal h3 {
  opacity: 0.6;
}

.meal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.meal-header h3 {
  margin-bottom: 0;
}
```

**Step 2: Update `createMealSection` in `public/app.js`**

Replace the `createMealSection` function to add a consumed toggle for baby meal sections. The key changes:
- Baby meal sections get a header wrapper with a consume toggle button
- The toggle calls `/api/weeks/:weekOf/days/:day/consume` or `/unconsume`
- Consumed state is read from `dayData[mealType + '_consumed']`
- Adult dinner does NOT get a toggle

Replace the `createMealSection` function:

```javascript
function createMealSection(title, sectionClass, fields, dayData) {
  const section = document.createElement('div');
  section.className = 'meal-section ' + sectionClass;

  // Determine meal type from sectionClass (e.g., 'baby-breakfast' → 'baby_breakfast')
  const mealType = sectionClass.replace('-', '_');
  const isBabyMeal = mealType.startsWith('baby_');
  const consumedKey = mealType + '_consumed';
  const isConsumed = isBabyMeal && dayData[consumedKey] === 1;

  if (isConsumed) {
    section.classList.add('consumed-meal');
  }

  if (isBabyMeal) {
    // Wrap h3 and toggle button in a header row
    const headerRow = document.createElement('div');
    headerRow.className = 'meal-header';

    const h3 = document.createElement('h3');
    h3.textContent = title;
    headerRow.appendChild(h3);

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'consume-toggle' + (isConsumed ? ' consumed' : '');
    toggleBtn.textContent = '✓';
    toggleBtn.title = isConsumed ? 'Mark as not consumed' : 'Mark as consumed';
    toggleBtn.addEventListener('click', async () => {
      const currentlyConsumed = toggleBtn.classList.contains('consumed');
      const action = currentlyConsumed ? 'unconsume' : 'consume';
      try {
        const res = await fetch(`/api/weeks/${currentWeekOf}/days/${dayData.day}/${action}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ meal: mealType }),
        });
        if (!res.ok) throw new Error(`Failed to ${action}: ${res.status}`);

        toggleBtn.classList.toggle('consumed');
        section.classList.toggle('consumed-meal');
        toggleBtn.title = toggleBtn.classList.contains('consumed')
          ? 'Mark as not consumed'
          : 'Mark as consumed';
      } catch (err) {
        console.error(`Error ${action} meal:`, err);
        showError(`Failed to ${action} meal. Please try again.`);
      }
    });

    headerRow.appendChild(toggleBtn);
    section.appendChild(headerRow);
  } else {
    const h3 = document.createElement('h3');
    h3.textContent = title;
    section.appendChild(h3);
  }

  const grid = document.createElement('div');
  grid.className = 'meal-fields';

  fields.forEach((f) => {
    const label = document.createElement('label');
    label.textContent = f.label;
    label.setAttribute('for', `${dayData.day}-${f.key}`);

    const input = document.createElement('input');
    input.type = 'text';
    input.id = `${dayData.day}-${f.key}`;
    input.value = dayData[f.key] || '';
    input.placeholder = f.label;
    input.maxLength = MAX_FIELD_LENGTH;

    input.addEventListener('input', () => {
      debouncedSave(input, currentWeekOf, dayData.day, f.key);
    });

    grid.appendChild(label);
    grid.appendChild(input);
  });

  section.appendChild(grid);
  return section;
}
```

**Step 3: Manually test in browser**

Run: `npm run start:dev`
- Open http://localhost:3000
- Verify baby meal sections show a small circle toggle
- Click toggle — it should fill green with a checkmark
- Meal fields should get strikethrough styling
- Click again — should unconsume
- Adult Dinner should NOT have a toggle

**Step 4: Commit**

```bash
git add public/app.js public/style.css
git commit -m "feat(inventory): add consumed toggle buttons to weekly view baby meals"
```

---

### Task 5: Frontend — Inventory page with navigation

**Files:**
- Modify: `public/index.html` (add inventory button to header)
- Modify: `public/app.js` (add inventory page rendering + navigation)
- Modify: `public/style.css` (add inventory page styles)

**Step 1: Add inventory button to header in `index.html`**

In `public/index.html`, add an "Inventory" button in the `header-actions` div (after the copy-btn):

```html
      <button id="inventory-btn" class="btn-small">Inventory</button>
```

**Step 2: Add inventory page styles to `style.css`**

Append to `public/style.css`:

```css
/* ── Inventory page ── */
.inventory-view {
  max-width: 800px;
  margin: 0 auto;
  padding: 24px;
}

.inventory-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
  flex-wrap: wrap;
  gap: 12px;
}

.inventory-header h2 {
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--text-primary);
}

.lookahead-selector {
  display: flex;
  gap: 4px;
  background: var(--bg-button);
  border-radius: 10px;
  padding: 3px;
  box-shadow: var(--shadow-button);
}

.lookahead-btn {
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 0.82rem;
  font-weight: 500;
  background: transparent;
  box-shadow: none;
  color: var(--text-tertiary);
}

.lookahead-btn:hover {
  background: transparent;
  box-shadow: none;
  transform: none;
  color: var(--text-primary);
}

.lookahead-btn.active {
  background: var(--gradient-primary);
  color: white;
  font-weight: 600;
}

.lookahead-btn.active:hover {
  background: var(--gradient-primary-hover);
  transform: none;
  box-shadow: none;
}

.inventory-category {
  margin-bottom: 20px;
}

.inventory-category h3 {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--text-muted);
  letter-spacing: 0.8px;
  margin-bottom: 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border-divider);
}

.inventory-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 10px;
  margin-bottom: 6px;
  transition: background 0.15s ease;
}

.inventory-item:hover {
  background: var(--list-hover);
}

.inventory-item.needs-prep {
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.2);
}

[data-theme="dark"] .inventory-item.needs-prep {
  background: rgba(245, 158, 11, 0.06);
  border-color: rgba(245, 158, 11, 0.15);
}

.inventory-item.stocked {
  background: rgba(16, 185, 129, 0.06);
  border: 1px solid rgba(16, 185, 129, 0.15);
}

[data-theme="dark"] .inventory-item.stocked {
  background: rgba(16, 185, 129, 0.05);
  border-color: rgba(16, 185, 129, 0.12);
}

.ingredient-name {
  flex: 1;
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--text-primary);
}

.stock-controls {
  display: flex;
  align-items: center;
  gap: 6px;
}

.stock-btn {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  padding: 0;
  font-size: 1rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: none;
  color: var(--text-tertiary);
}

.stock-btn:hover {
  box-shadow: none;
  transform: none;
  color: var(--text-primary);
}

.stock-count {
  min-width: 28px;
  text-align: center;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary);
}

.needed-count {
  font-size: 0.82rem;
  color: var(--text-muted);
  min-width: 60px;
  text-align: right;
}

.to-make-count {
  font-size: 0.82rem;
  font-weight: 600;
  min-width: 70px;
  text-align: right;
  color: #d97706;
}

.to-make-count.zero {
  color: var(--save-color);
}

.inventory-empty {
  text-align: center;
  color: var(--text-muted);
  padding: 48px 20px;
  font-size: 0.95rem;
}

.inventory-section-label {
  font-size: 0.8rem;
  color: var(--text-muted);
  margin-top: 32px;
  margin-bottom: 12px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border-divider);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
```

**Step 3: Add inventory page JavaScript to `public/app.js`**

Add these variables near the top (after `let saveTimers = {};`):

```javascript
/** Currently active page: 'meals' or 'inventory' */
let currentPage = 'meals';

/** Current lookahead days for inventory */
let inventoryLookahead = 7;
```

Add the inventory rendering functions (before the `// Initialize the app` comment at the bottom):

```javascript
/**
 * Category display configuration for inventory.
 */
const CATEGORY_ORDER = ['meat', 'vegetable', 'fruit', 'cereal', 'yogurt'];
const CATEGORY_LABELS = {
  meat: 'Meat',
  vegetable: 'Vegetable',
  fruit: 'Fruit',
  cereal: 'Cereal',
  yogurt: 'Yogurt',
  '': 'Other',
};

/**
 * Fetches inventory data from the API.
 */
async function fetchInventory() {
  try {
    const res = await fetch(`/api/inventory?lookahead=${inventoryLookahead}`);
    if (!res.ok) throw new Error(`Failed to fetch inventory: ${res.status}`);
    return res.json();
  } catch (err) {
    console.error('Error fetching inventory:', err);
    showError('Failed to load inventory. Please try again.');
    throw err;
  }
}

/**
 * Updates stock via API and refreshes the inventory display.
 */
async function updateStockApi(ingredient, delta) {
  try {
    const res = await fetch(`/api/inventory/${encodeURIComponent(ingredient)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delta }),
    });
    if (!res.ok) throw new Error(`Failed to update stock: ${res.status}`);
    return true;
  } catch (err) {
    console.error('Error updating stock:', err);
    showError('Failed to update stock. Please try again.');
    return false;
  }
}

/**
 * Creates an inventory item row element.
 */
function createInventoryItem(item) {
  const row = document.createElement('div');
  row.className = 'inventory-item';
  if (item.toMake > 0) {
    row.classList.add('needs-prep');
  } else if (item.stock >= item.needed && item.needed > 0) {
    row.classList.add('stocked');
  }

  const name = document.createElement('span');
  name.className = 'ingredient-name';
  name.textContent = item.displayName;
  row.appendChild(name);

  // Stock controls
  const controls = document.createElement('div');
  controls.className = 'stock-controls';

  const minusBtn = document.createElement('button');
  minusBtn.className = 'stock-btn';
  minusBtn.textContent = '−';
  minusBtn.addEventListener('click', async () => {
    const success = await updateStockApi(item.ingredient, -1);
    if (success) loadInventory();
  });

  const stockCount = document.createElement('span');
  stockCount.className = 'stock-count';
  stockCount.textContent = item.stock;

  const plusBtn = document.createElement('button');
  plusBtn.className = 'stock-btn';
  plusBtn.textContent = '+';
  plusBtn.addEventListener('click', async () => {
    const success = await updateStockApi(item.ingredient, 1);
    if (success) loadInventory();
  });

  controls.appendChild(minusBtn);
  controls.appendChild(stockCount);
  controls.appendChild(plusBtn);
  row.appendChild(controls);

  // Needed count
  const needed = document.createElement('span');
  needed.className = 'needed-count';
  needed.textContent = `need ${item.needed}`;
  row.appendChild(needed);

  // To make count
  const toMake = document.createElement('span');
  toMake.className = 'to-make-count' + (item.toMake === 0 ? ' zero' : '');
  toMake.textContent = item.toMake > 0 ? `make ${item.toMake}` : 'ready';
  row.appendChild(toMake);

  return row;
}

/**
 * Renders the inventory page.
 */
function renderInventory(data) {
  const container = document.getElementById('week-view');
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  const view = document.createElement('div');
  view.className = 'inventory-view';

  // Header with lookahead selector
  const header = document.createElement('div');
  header.className = 'inventory-header';

  const title = document.createElement('h2');
  title.textContent = 'Baby Meal Inventory';
  header.appendChild(title);

  const selector = document.createElement('div');
  selector.className = 'lookahead-selector';
  [3, 5, 7].forEach(days => {
    const btn = document.createElement('button');
    btn.className = 'lookahead-btn' + (days === inventoryLookahead ? ' active' : '');
    btn.textContent = `${days}d`;
    btn.addEventListener('click', () => {
      inventoryLookahead = days;
      loadInventory();
    });
    selector.appendChild(btn);
  });
  header.appendChild(selector);
  view.appendChild(header);

  // Empty state
  if (data.items.length === 0 && data.otherStock.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'inventory-empty';
    empty.textContent = `No baby meals planned for the next ${data.lookahead} days.`;
    view.appendChild(empty);
    container.appendChild(view);
    return;
  }

  // Group items by category
  const grouped = {};
  for (const item of data.items) {
    const cat = item.category || '';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(item);
  }

  // Render categories in order
  for (const cat of CATEGORY_ORDER) {
    if (!grouped[cat] || grouped[cat].length === 0) continue;

    const section = document.createElement('div');
    section.className = 'inventory-category';

    const catTitle = document.createElement('h3');
    catTitle.textContent = CATEGORY_LABELS[cat] || cat;
    section.appendChild(catTitle);

    for (const item of grouped[cat]) {
      section.appendChild(createInventoryItem(item));
    }

    view.appendChild(section);
  }

  // Other stock section
  if (data.otherStock.length > 0) {
    const label = document.createElement('div');
    label.className = 'inventory-section-label';
    label.textContent = 'Other Stock';
    view.appendChild(label);

    for (const item of data.otherStock) {
      view.appendChild(createInventoryItem(item));
    }
  }

  container.appendChild(view);
}

/**
 * Loads and renders the inventory page.
 */
async function loadInventory() {
  try {
    const data = await fetchInventory();
    renderInventory(data);
  } catch {
    // Error already shown
  }
}

/**
 * Switches between meal plan and inventory views.
 */
function showPage(page) {
  currentPage = page;

  // Toggle header element visibility
  const weekNav = document.querySelector('.week-nav');
  const inventoryBtn = document.getElementById('inventory-btn');
  const historyBtn = document.getElementById('history-btn');
  const copyBtn = document.getElementById('copy-btn');

  if (page === 'inventory') {
    weekNav.style.display = 'none';
    historyBtn.style.display = 'none';
    copyBtn.style.display = 'none';
    inventoryBtn.textContent = 'Meal Plan';
    loadInventory();
  } else {
    weekNav.style.display = '';
    historyBtn.style.display = '';
    copyBtn.style.display = '';
    inventoryBtn.textContent = 'Inventory';
    loadWeek();
  }
}

// Inventory button handler
document.getElementById('inventory-btn').addEventListener('click', () => {
  showPage(currentPage === 'inventory' ? 'meals' : 'inventory');
});
```

**Step 4: Manually test in browser**

Run: `npm run start:dev`
- Click "Inventory" button — should show inventory page
- Lookahead selector should toggle between 3/5/7 days
- +/- buttons should update stock counts
- Items should be color-coded (amber for needs-prep, green for stocked)
- Click "Meal Plan" to go back to weekly view
- Verify weekly view consume toggles still work

**Step 5: Commit**

```bash
git add public/index.html public/app.js public/style.css
git commit -m "feat(inventory): add inventory page with stock management and lookahead selector"
```

---

### Task 6: Final integration testing and cleanup

**Files:**
- All files touched above

**Step 1: Run full test suite**

Run: `npm test`
Expected: All PASS

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 3: Run build**

Run: `npm run build`
Expected: PASS — compiles without errors

**Step 4: Manual end-to-end test**

Run: `npm run start:dev`

Test checklist:
- [ ] Weekly view: baby meal consumed toggles work (check/uncheck)
- [ ] Weekly view: consumed meals show strikethrough styling
- [ ] Weekly view: adult dinner has NO consume toggle
- [ ] Inventory page: shows correct ingredients from meal plan
- [ ] Inventory page: +/- buttons update stock
- [ ] Inventory page: lookahead selector (3/5/7) updates list
- [ ] Inventory page: "make N" counts are correct
- [ ] Inventory page: color coding (amber=needs prep, green=stocked)
- [ ] Inventory page: consuming a meal on weekly view updates inventory counts
- [ ] Navigation: toggling between Meal Plan and Inventory works
- [ ] Dark mode: inventory page looks correct in both themes

**Step 5: Commit any fixes**

If any fixes were needed during manual testing, commit them.

**Step 6: Final commit — update CLAUDE.md**

Update `CLAUDE.md` to document the new inventory feature:
- New API endpoints
- New database table
- New consumed columns
- Frontend inventory page

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with inventory feature documentation"
```
