/**
 * @fileoverview Frontend JavaScript for the Meal Planner application.
 * Provides UI interactions for viewing and editing weekly meal plans.
 * Uses vanilla JavaScript with no frameworks.
 * @module app
 */

/** Day names indexed by day number (0 = Monday, 6 = Sunday) */
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Configuration constants
/** Delay before saving after user stops typing (ms) */
const DEBOUNCE_DELAY_MS = 400;

// Theme management
const THEME_KEY = 'theme';

/**
 * Gets the current theme, falling back to system preference.
 * @returns {string} 'dark' or 'light'
 */
function getTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored) return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Sets the theme and updates localStorage and UI.
 * @param {string} theme - 'dark' or 'light'
 */
function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
  updateThemeIcon(theme);
}

/**
 * Updates the theme toggle button icon.
 * @param {string} theme - Current theme
 */
function updateThemeIcon(theme) {
  const icon = document.querySelector('#theme-toggle .theme-icon');
  if (icon) icon.textContent = theme === 'dark' ? '☀️' : '🌙';
}

/**
 * Toggles between light and dark themes.
 */
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || getTheme();
  setTheme(current === 'dark' ? 'light' : 'dark');
}
/** Duration to show green border feedback after save (ms) */
const SAVE_FEEDBACK_DURATION_MS = 600;
/** Duration to show error toast messages (ms) */
const ERROR_TOAST_DURATION_MS = 5000;
/** Maximum length for regular input fields */
const MAX_FIELD_LENGTH = 500;
/** Maximum length for note fields */
const MAX_NOTE_LENGTH = 1000;

/**
 * Field definitions for meal sections.
 * Organized by meal type with field keys and display labels.
 * @constant {Object}
 */
const FIELDS = {
  baby_breakfast: [
    { key: 'baby_breakfast_cereal', label: 'Cereal' },
    { key: 'baby_breakfast_yogurt', label: 'Yogurt' },
    { key: 'baby_breakfast_fruit', label: 'Fruit' },
  ],
  baby_lunch: [
    { key: 'baby_lunch_meat', label: 'Meat' },
    { key: 'baby_lunch_vegetable', label: 'Vegetable' },
    { key: 'baby_lunch_fruit', label: 'Fruit' },
  ],
  baby_dinner: [
    { key: 'baby_dinner_meat', label: 'Meat' },
    { key: 'baby_dinner_vegetable', label: 'Vegetable' },
    { key: 'baby_dinner_fruit', label: 'Fruit' },
  ],
  adult_dinner: [
    { key: 'adult_dinner', label: 'Dinner' },
  ],
};

/** Currently displayed week (Monday date in YYYY-MM-DD format) */
let currentWeekOf = getMonday(new Date());

/** Map of timer IDs for debounced saves, keyed by "dayIndex-fieldKey" */
let saveTimers = {};

/**
 * Calculates the Monday of the week containing the given date.
 * @param {Date} date - A Date object
 * @returns {string} The Monday date in YYYY-MM-DD format
 */
function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  // Convert Sunday (0) to -6, otherwise 1-day to get Monday
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return formatDate(d);
}

/**
 * Formats a Date object as YYYY-MM-DD string.
 * @param {Date} d - Date object to format
 * @returns {string} Formatted date string
 */
function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Adds days to a date string.
 * @param {string} dateStr - Date in YYYY-MM-DD format
 * @param {number} n - Number of days to add (can be negative)
 * @returns {string} New date in YYYY-MM-DD format
 */
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return formatDate(d);
}

/**
 * Formats a week date range for display (e.g., "Jan 15 – Jan 21, 2024").
 * @param {string} weekOf - Monday date in YYYY-MM-DD format
 * @returns {string} Formatted date range string
 */
function formatWeekLabel(weekOf) {
  const start = new Date(weekOf + 'T00:00:00');
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const opts = { month: 'short', day: 'numeric' };
  const startStr = start.toLocaleDateString('en-US', opts);
  const endStr = end.toLocaleDateString('en-US', { ...opts, year: 'numeric' });
  return `${startStr} – ${endStr}`;
}

/**
 * Gets the day index (0-6) for today if viewing the current week.
 * Returns -1 if viewing a different week.
 * @returns {number} Today's day index or -1
 */
function getTodayDayIndex() {
  const today = new Date();
  const todayMonday = getMonday(today);
  if (todayMonday !== currentWeekOf) return -1;
  const day = today.getDay();
  return day === 0 ? 6 : day - 1;
}

/**
 * Fetches week data from the API.
 * @param {string} weekOf - Monday date in YYYY-MM-DD format
 * @returns {Promise<Object>} Week data with days array
 * @throws {Error} If fetch fails
 */
async function fetchWeek(weekOf) {
  try {
    const res = await fetch(`/api/weeks/${weekOf}`);
    if (!res.ok) {
      throw new Error(`Failed to fetch week: ${res.status}`);
    }
    return res.json();
  } catch (err) {
    console.error('Error fetching week:', err);
    showError('Failed to load week data. Please try again.');
    throw err;
  }
}

/**
 * Displays an error toast message.
 * Removes any existing toast first.
 * @param {string} message - Error message to display
 */
function showError(message) {
  const existing = document.querySelector('.error-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'error-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), ERROR_TOAST_DURATION_MS);
}

/**
 * Validates a date string is parseable.
 * @param {string} dateStr - Date string to validate
 * @returns {boolean} True if valid date
 */
function isValidDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return !isNaN(d.getTime());
}

/**
 * Saves a single field value to the API.
 * @param {string} weekOf - Monday date in YYYY-MM-DD format
 * @param {number} dayIndex - Day index (0-6)
 * @param {string} field - Field key to update
 * @param {string} value - New value
 * @returns {Promise<boolean>} True if save succeeded
 */
async function saveField(weekOf, dayIndex, field, value) {
  try {
    const res = await fetch(`/api/weeks/${weekOf}/days/${dayIndex}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    });
    if (!res.ok) {
      throw new Error(`Failed to save: ${res.status}`);
    }
    return true;
  } catch (err) {
    console.error('Error saving field:', err);
    showError('Failed to save changes. Please try again.');
    return false;
  }
}

/**
 * Clears all pending save timers.
 * Should be called before navigating to a new week.
 */
function clearAllSaveTimers() {
  Object.values(saveTimers).forEach(clearTimeout);
  saveTimers = {};
}

/**
 * Schedules a debounced save for an input field.
 * Cancels any pending save for the same field.
 * @param {HTMLInputElement} input - The input element
 * @param {string} weekOf - Monday date in YYYY-MM-DD format
 * @param {number} dayIndex - Day index (0-6)
 * @param {string} field - Field key
 */
function debouncedSave(input, weekOf, dayIndex, field) {
  const timerId = `${dayIndex}-${field}`;
  clearTimeout(saveTimers[timerId]);
  saveTimers[timerId] = setTimeout(async () => {
    input.classList.add('saving');
    const success = await saveField(weekOf, dayIndex, field, input.value);
    if (success) {
      setTimeout(() => input.classList.remove('saving'), SAVE_FEEDBACK_DURATION_MS);
    } else {
      input.classList.remove('saving');
      input.classList.add('error');
      setTimeout(() => input.classList.remove('error'), SAVE_FEEDBACK_DURATION_MS);
    }
  }, DEBOUNCE_DELAY_MS);
}

/**
 * Renders the week view with all day cards.
 * Uses safe DOM manipulation to prevent XSS.
 * @param {Object} weekData - Week data from API
 */
function renderWeek(weekData) {
  const container = document.getElementById('week-view');
  // Clear container safely
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  document.getElementById('week-label').textContent = formatWeekLabel(currentWeekOf);

  const todayIndex = getTodayDayIndex();

  weekData.days.forEach((day) => {
    const card = document.createElement('div');
    card.className = 'day-card' + (day.day === todayIndex ? ' today' : '');

    // Add ID to today's card for scrolling
    if (day.day === todayIndex) {
      card.id = 'today-card';
    }

    const dateStr = addDays(currentWeekOf, day.day);
    const dateObj = new Date(dateStr + 'T00:00:00');
    const dateLabel = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    // Create header using safe DOM methods (prevents XSS)
    const header = document.createElement('h2');
    header.textContent = DAY_NAMES[day.day] + ' ';
    const dateSpan = document.createElement('span');
    dateSpan.className = 'day-date';
    dateSpan.textContent = dateLabel;
    header.appendChild(dateSpan);
    card.appendChild(header);

    // Day-level note
    const noteInput = document.createElement('input');
    noteInput.type = 'text';
    noteInput.className = 'day-note';
    noteInput.value = day.note || '';
    noteInput.placeholder = 'Add a note...';
    noteInput.maxLength = MAX_NOTE_LENGTH;
    noteInput.addEventListener('input', () => {
      debouncedSave(noteInput, currentWeekOf, day.day, 'note');
    });
    card.appendChild(noteInput);

    // Adult Dinner
    card.appendChild(createMealSection('Adult Dinner', 'adult-dinner', FIELDS.adult_dinner, day));
    // Baby Breakfast
    card.appendChild(createMealSection('Baby Breakfast', 'baby-breakfast', FIELDS.baby_breakfast, day));
    // Baby Lunch
    card.appendChild(createMealSection('Baby Lunch', 'baby-lunch', FIELDS.baby_lunch, day));
    // Baby Dinner
    card.appendChild(createMealSection('Baby Dinner', 'baby-dinner', FIELDS.baby_dinner, day));

    container.appendChild(card);
  });
}

/**
 * Creates a meal section element with title and input fields.
 * Uses safe DOM manipulation to prevent XSS.
 * @param {string} title - Section title (e.g., "Adult Dinner")
 * @param {string} sectionClass - CSS class for the section
 * @param {Array<Object>} fields - Field definitions
 * @param {Object} dayData - Day data from API
 * @returns {HTMLElement} The section element
 */
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

/**
 * Loads and renders the current week.
 * Clears pending save timers before loading.
 */
async function loadWeek() {
  // Clear any pending saves from the previous week
  clearAllSaveTimers();

  try {
    const data = await fetchWeek(currentWeekOf);
    renderWeek(data);
  } catch {
    // Error already shown by fetchWeek
    return;
  }
}

// Navigation event handlers
document.getElementById('prev-week').addEventListener('click', () => {
  currentWeekOf = addDays(currentWeekOf, -7);
  loadWeek();
});

document.getElementById('next-week').addEventListener('click', () => {
  currentWeekOf = addDays(currentWeekOf, 7);
  loadWeek();
});

document.getElementById('today-btn').addEventListener('click', async () => {
  currentWeekOf = getMonday(new Date());
  await loadWeek();
  // Scroll to today's card
  const todayCard = document.getElementById('today-card');
  if (todayCard) {
    todayCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
});

/**
 * Shows a modal dialog with the given title and content.
 * @param {string} title - Modal title
 * @param {string|HTMLElement} content - Text string or DOM element
 */
function showModal(title, content) {
  document.getElementById('modal-title').textContent = title;
  const body = document.getElementById('modal-body');
  // Clear body safely
  while (body.firstChild) {
    body.removeChild(body.firstChild);
  }
  if (typeof content === 'string') {
    body.textContent = content;
  } else {
    body.appendChild(content);
  }
  document.getElementById('modal-overlay').classList.remove('hidden');
}

/**
 * Hides the modal dialog.
 */
function hideModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

document.getElementById('modal-close').addEventListener('click', hideModal);
document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) hideModal();
});

// History button handler
document.getElementById('history-btn').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/weeks');
    if (!res.ok) {
      throw new Error(`Failed to fetch history: ${res.status}`);
    }
    const weeks = await res.json();
    if (weeks.length === 0) {
      const emptyMsg = document.createElement('p');
      emptyMsg.style.color = '#888';
      emptyMsg.textContent = 'No saved weeks yet.';
      showModal('History', emptyMsg);
      return;
    }
    const ul = document.createElement('ul');
    ul.className = 'week-list';
    weeks.forEach((w) => {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = formatWeekLabel(w.week_of);
      const btn = document.createElement('button');
      btn.textContent = 'View';
      btn.addEventListener('click', () => {
        currentWeekOf = w.week_of;
        hideModal();
        loadWeek();
      });
      li.appendChild(span);
      li.appendChild(btn);
      ul.appendChild(li);
    });
    showModal('History', ul);
  } catch (err) {
    console.error('Error loading history:', err);
    showError('Failed to load history. Please try again.');
  }
});

// Copy Week button handler
document.getElementById('copy-btn').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/weeks');
    if (!res.ok) {
      throw new Error(`Failed to fetch weeks: ${res.status}`);
    }
    const weeks = await res.json();

    const form = document.createElement('div');
    form.className = 'copy-form';

    const sourceDiv = document.createElement('div');
    const sourceLabel = document.createElement('label');
    sourceLabel.textContent = 'Copy from:';
    const sourceSelect = document.createElement('select');
    sourceSelect.id = 'copy-source';
    weeks.forEach((w) => {
      const opt = document.createElement('option');
      opt.value = w.week_of;
      opt.textContent = formatWeekLabel(w.week_of);
      sourceSelect.appendChild(opt);
    });
    sourceDiv.appendChild(sourceLabel);
    sourceDiv.appendChild(sourceSelect);

    const targetDiv = document.createElement('div');
    const targetLabel = document.createElement('label');
    targetLabel.textContent = 'Copy to (pick any Monday):';
    const targetInput = document.createElement('input');
    targetInput.type = 'date';
    targetInput.id = 'copy-target';
    targetInput.value = addDays(currentWeekOf, 7);
    targetDiv.appendChild(targetLabel);
    targetDiv.appendChild(targetInput);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn-primary';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', async () => {
      try {
        const source = sourceSelect.value;
        const targetRaw = targetInput.value;

        if (!targetRaw || !isValidDate(targetRaw)) {
          showError('Please select a valid date.');
          return;
        }

        const target = getMonday(new Date(targetRaw + 'T00:00:00'));

        const copyRes = await fetch(`/api/weeks/${source}/copy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetWeekOf: target }),
        });
        if (!copyRes.ok) {
          throw new Error(`Failed to copy: ${copyRes.status}`);
        }

        currentWeekOf = target;
        hideModal();
        loadWeek();
      } catch (err) {
        console.error('Error copying week:', err);
        showError('Failed to copy week. Please try again.');
      }
    });

    form.appendChild(sourceDiv);
    form.appendChild(targetDiv);
    form.appendChild(copyBtn);

    showModal('Copy Week', form);
  } catch (err) {
    console.error('Error loading copy dialog:', err);
    showError('Failed to load copy dialog. Please try again.');
  }
});

// Theme toggle
document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  if (!localStorage.getItem(THEME_KEY)) setTheme(e.matches ? 'dark' : 'light');
});

// Initialize theme - ensure attribute is set and icon matches
// (handles case where inline script in <head> didn't run or failed)
const initialTheme = document.documentElement.getAttribute('data-theme');
if (!initialTheme) {
  // Inline script didn't set the attribute, apply theme now
  setTheme(getTheme());
} else {
  // Inline script worked, just sync the icon to match the actual attribute
  updateThemeIcon(initialTheme);
}

// Initialize the app
loadWeek();
