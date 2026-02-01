const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const FIELDS = {
  baby_lunch: [
    { key: 'baby_lunch_cereal', label: 'Cereal' },
    { key: 'baby_lunch_fruit', label: 'Fruit' },
    { key: 'baby_lunch_yogurt', label: 'Yogurt' },
  ],
  baby_dinner: [
    { key: 'baby_dinner_cereal', label: 'Cereal' },
    { key: 'baby_dinner_fruit', label: 'Fruit' },
    { key: 'baby_dinner_vegetable', label: 'Vegetable' },
  ],
  adult_dinner: [
    { key: 'adult_dinner', label: 'Dinner' },
  ],
};

let currentWeekOf = getMonday(new Date());
let saveTimers = {};

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return formatDate(d);
}

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return formatDate(d);
}

function formatWeekLabel(weekOf) {
  const start = new Date(weekOf + 'T00:00:00');
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const opts = { month: 'short', day: 'numeric' };
  const startStr = start.toLocaleDateString('en-US', opts);
  const endStr = end.toLocaleDateString('en-US', { ...opts, year: 'numeric' });
  return `${startStr} – ${endStr}`;
}

function getTodayDayIndex() {
  const today = new Date();
  const todayMonday = getMonday(today);
  if (todayMonday !== currentWeekOf) return -1;
  const day = today.getDay();
  return day === 0 ? 6 : day - 1;
}

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

function showError(message) {
  const existing = document.querySelector('.error-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'error-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

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
  } catch (err) {
    console.error('Error saving field:', err);
    showError('Failed to save changes. Please try again.');
  }
}

function debouncedSave(input, weekOf, dayIndex, field) {
  const timerId = `${dayIndex}-${field}`;
  clearTimeout(saveTimers[timerId]);
  saveTimers[timerId] = setTimeout(async () => {
    input.classList.add('saving');
    await saveField(weekOf, dayIndex, field, input.value);
    setTimeout(() => input.classList.remove('saving'), 600);
  }, 400);
}

function renderWeek(weekData) {
  const container = document.getElementById('week-view');
  container.innerHTML = '';
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

    card.innerHTML = `<h2>${DAY_NAMES[day.day]} <span class="day-date">${dateLabel}</span></h2>`;

    // Day-level note
    const noteInput = document.createElement('input');
    noteInput.type = 'text';
    noteInput.className = 'day-note';
    noteInput.value = day.note || '';
    noteInput.placeholder = 'Add a note...';
    noteInput.addEventListener('input', () => {
      debouncedSave(noteInput, currentWeekOf, day.day, 'note');
    });
    card.appendChild(noteInput);

    // Adult Dinner
    card.appendChild(createMealSection('Adult Dinner', 'adult-dinner', FIELDS.adult_dinner, day));
    // Baby Lunch
    card.appendChild(createMealSection('Baby Lunch', 'baby-lunch', FIELDS.baby_lunch, day));
    // Baby Dinner
    card.appendChild(createMealSection('Baby Dinner', 'baby-dinner', FIELDS.baby_dinner, day));

    container.appendChild(card);
  });
}

function createMealSection(title, sectionClass, fields, dayData) {
  const section = document.createElement('div');
  section.className = 'meal-section ' + sectionClass;
  section.innerHTML = `<h3>${title}</h3>`;

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

    input.addEventListener('input', () => {
      debouncedSave(input, currentWeekOf, dayData.day, f.key);
    });

    grid.appendChild(label);
    grid.appendChild(input);
  });

  section.appendChild(grid);
  return section;
}

async function loadWeek() {
  try {
    const data = await fetchWeek(currentWeekOf);
    renderWeek(data);
  } catch {
    // Error already shown by fetchWeek
    return;
  }
}

// Navigation
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

// Modal helpers
function showModal(title, content) {
  document.getElementById('modal-title').textContent = title;
  const body = document.getElementById('modal-body');
  body.innerHTML = '';
  if (typeof content === 'string') {
    body.textContent = content;
  } else {
    body.appendChild(content);
  }
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function hideModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

document.getElementById('modal-close').addEventListener('click', hideModal);
document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) hideModal();
});

// History
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

// Copy Week
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

// Init
loadWeek();
