/**
 * @fileoverview Centralized type definitions for the Meal Planner application.
 * @module types
 */

// ============ Database Record Types ============

/** Database record for a week */
export interface WeekRecord {
  id: number;
  week_of: string; // YYYY-MM-DD format (always a Monday)
}

/** Database record for a day */
export interface DayRecord {
  id: number;
  week_id: number;
  day: number; // 0 = Monday, 6 = Sunday
  baby_lunch_cereal: string;
  baby_lunch_fruit: string;
  baby_lunch_yogurt: string;
  baby_dinner_cereal: string;
  baby_dinner_fruit: string;
  baby_dinner_vegetable: string;
  adult_dinner: string;
  note: string;
}

/** Week with its associated days */
export interface WeekWithDays extends WeekRecord {
  days: DayRecord[];
}

// ============ API Response Types ============

/** Baby meal structure for API responses */
export interface BabyMeals {
  lunch: {
    cereal: string;
    fruit: string;
    yogurt: string;
  };
  dinner: {
    cereal: string;
    fruit: string;
    vegetable: string;
  };
}

/** Adult meal structure for API responses */
export interface AdultMeals {
  dinner: string;
}

/** Formatted day for public API responses */
export interface FormattedDay {
  day: string; // Day name (e.g., "Monday")
  baby: BabyMeals;
  adult: AdultMeals;
  note: string;
}

/** Formatted week for public API responses */
export interface FormattedWeek {
  week_of: string;
  days: FormattedDay[];
}

/** Upcoming day response (includes date) */
export interface UpcomingDay extends FormattedDay {
  date: string; // YYYY-MM-DD format
}

/** Response from /api/schedule/upcoming */
export interface UpcomingScheduleResponse {
  days: UpcomingDay[];
  updated_at: string; // HH:MM format
}

// ============ Request Body Types ============

/** Allowed fields for day updates */
export type DayFieldKey =
  | 'baby_lunch_cereal'
  | 'baby_lunch_fruit'
  | 'baby_lunch_yogurt'
  | 'baby_dinner_cereal'
  | 'baby_dinner_fruit'
  | 'baby_dinner_vegetable'
  | 'adult_dinner'
  | 'note';

/** Request body for PUT /api/weeks/:weekOf/days/:day */
export type DayUpdateRequest = Partial<Record<DayFieldKey, string>>;

/** Request body for POST /api/weeks/:weekOf/copy */
export interface CopyWeekRequest {
  targetWeekOf: string;
}

// ============ Configuration Types ============

/** Path resolver functions */
export interface PathConfig {
  db: (dirname: string) => string;
  logs: (dirname: string) => string;
  public: (dirname: string) => string;
}

/** Application configuration */
export interface AppConfig {
  // Server
  port: number | string;
  maxJsonBodySize: string;

  // Rate limiting
  rateLimitWindowMs: number;
  rateLimitReadMax: number;
  rateLimitWriteMax: number;

  // Database
  maxFieldLength: number;
  maxNoteLength: number;
  maxWeeksReturned: number;

  // Timezone
  timezone: string;

  // Logging
  logLevel: string;
  nodeEnv: string;

  // Paths
  paths: PathConfig;
}

// ============ Date Parts Type ============

/** Parts of a date returned by Intl.DateTimeFormat */
export interface DateParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  [key: string]: string;
}

// ============ Express Extensions ============

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}
