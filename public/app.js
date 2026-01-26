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
    { key: 'adult_dinner_note', label: 'Note' },
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
  const res = await fetch(`/api/weeks/${weekOf}`);
  return res.json();
}

async function saveField(weekOf, dayIndex, field, value) {
  await fetch(`/api/weeks/${weekOf}/days/${dayIndex}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [field]: value }),
  });
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

    const dateStr = addDays(currentWeekOf, day.day);
    const dateObj = new Date(dateStr + 'T00:00:00');
    const dateLabel = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    card.innerHTML = `<h2>${DAY_NAMES[day.day]} <span class="day-date">${dateLabel}</span></h2>`;

    // Baby Lunch
    card.appendChild(createMealSection('Baby Lunch', FIELDS.baby_lunch, day));
    // Baby Dinner
    card.appendChild(createMealSection('Baby Dinner', FIELDS.baby_dinner, day));
    // Adult Dinner
    card.appendChild(createMealSection('Adult Dinner', FIELDS.adult_dinner, day));

    container.appendChild(card);
  });
}

function createMealSection(title, fields, dayData) {
  const section = document.createElement('div');
  section.className = 'meal-section';
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

    if (f.key === 'adult_dinner_note') {
      const wrapper = document.createElement('div');
      wrapper.className = 'note-field';
      wrapper.style.display = 'contents';
      input.placeholder = 'Optional note...';
    }

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
  const data = await fetchWeek(currentWeekOf);
  renderWeek(data);
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

document.getElementById('today-btn').addEventListener('click', () => {
  currentWeekOf = getMonday(new Date());
  loadWeek();
});

// Modal helpers
function showModal(title, contentHtml) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = contentHtml;
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
  const weeks = await (await fetch('/api/weeks')).json();
  if (weeks.length === 0) {
    showModal('History', '<p style="color:#888">No saved weeks yet.</p>');
    return;
  }
  const items = weeks.map((w) => {
    const label = formatWeekLabel(w.week_of);
    return `<li>
      <span>${label}</span>
      <button onclick="navigateToWeek('${w.week_of}')">View</button>
    </li>`;
  }).join('');
  showModal('History', `<ul class="week-list">${items}</ul>`);
});

window.navigateToWeek = function (weekOf) {
  currentWeekOf = weekOf;
  hideModal();
  loadWeek();
};

// Copy Week
document.getElementById('copy-btn').addEventListener('click', async () => {
  const weeks = await (await fetch('/api/weeks')).json();
  const options = weeks.map((w) => {
    const label = formatWeekLabel(w.week_of);
    return `<option value="${w.week_of}">${label}</option>`;
  }).join('');

  const nextMonday = addDays(currentWeekOf, 7);

  showModal('Copy Week', `
    <div class="copy-form">
      <div>
        <label>Copy from:</label>
        <select id="copy-source">${options}</select>
      </div>
      <div>
        <label>Copy to (pick any Monday):</label>
        <input type="date" id="copy-target" value="${nextMonday}">
      </div>
      <button class="btn-primary" onclick="executeCopy()">Copy</button>
    </div>
  `);
});

window.executeCopy = async function () {
  const source = document.getElementById('copy-source').value;
  const targetRaw = document.getElementById('copy-target').value;
  const target = getMonday(new Date(targetRaw + 'T00:00:00'));

  await fetch(`/api/weeks/${source}/copy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetWeekOf: target }),
  });

  currentWeekOf = target;
  hideModal();
  loadWeek();
};

// Init
loadWeek();
