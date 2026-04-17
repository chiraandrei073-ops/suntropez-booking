const MONTH_NAMES_LONG = ['Ianuarie','Februarie','Martie','Aprilie','Mai','Iunie','Iulie','August','Septembrie','Octombrie','Noiembrie','Decembrie'];

let currentMonth = new Date().getMonth();
let currentYear  = new Date().getFullYear();
let selectedDate = null;
let selectedSlots = [];
let slotsData = [];

const MAX_DAYS_AHEAD = 14;

function today() {
  const d = new Date(); d.setHours(0,0,0,0); return d;
}

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function formatHour(h) {
  return `${String(h).padStart(2,'0')}:00`;
}

function formatDateLong(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('ro-RO', { weekday: 'long', day: 'numeric', month: 'long' });
}

// --- RENDER MONTH CALENDAR ---
function renderCalendar() {
  const grid = document.getElementById('days-grid');
  const todayDate = today();
  const maxDate = new Date(todayDate);
  maxDate.setDate(maxDate.getDate() + MAX_DAYS_AHEAD);

  document.getElementById('month-label').textContent =
    `${MONTH_NAMES_LONG[currentMonth]} ${currentYear}`;

  grid.innerHTML = '';

  // First day of month (0=Sun..6=Sat), convert to Mon-first (0=Mon..6=Sun)
  const firstDay = new Date(currentYear, currentMonth, 1).getDay();
  const offset = (firstDay === 0) ? 6 : firstDay - 1;

  // Days in month
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

  // Empty cells before first day
  for (let i = 0; i < offset; i++) {
    const empty = document.createElement('div');
    empty.className = 'day-btn other-month';
    grid.appendChild(empty);
  }

  // Day cells
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(currentYear, currentMonth, d);
    const key = dateKey(date);
    const isPast   = date < todayDate;
    const isTooFar = date > maxDate;
    const isToday  = date.getTime() === todayDate.getTime();
    const isSelected = selectedDate === key;

    const btn = document.createElement('button');
    let cls = 'day-btn';
    if (isPast)    cls += ' past';
    if (isTooFar)  cls += ' too-far';
    if (isToday)   cls += ' today';
    if (isSelected) cls += ' selected';
    btn.className = cls;
    btn.innerHTML = `${d}<span class="day-dot"></span>`;

    if (!isPast && !isTooFar) {
      btn.addEventListener('click', () => selectDate(key));
    }
    grid.appendChild(btn);
  }
}

// Prevent going to past months or > 2 months ahead
document.getElementById('prev-month').addEventListener('click', () => {
  const t = today();
  const prevYear  = currentMonth === 0 ? currentYear - 1 : currentYear;
  const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
  if (prevYear < t.getFullYear() || (prevYear === t.getFullYear() && prevMonth < t.getMonth())) return;
  currentYear = prevYear;
  currentMonth = prevMonth;
  renderCalendar();
});

document.getElementById('next-month').addEventListener('click', () => {
  const t = today();
  const maxDate = new Date(t); maxDate.setDate(t.getDate() + MAX_DAYS_AHEAD);
  const nextMonth = currentMonth === 11 ? 0 : currentMonth + 1;
  const nextYear  = currentMonth === 11 ? currentYear + 1 : currentYear;
  // Only go forward if there are bookable days in next month
  const firstOfNext = new Date(nextYear, nextMonth, 1);
  if (firstOfNext > maxDate) return;
  currentYear = nextYear;
  currentMonth = nextMonth;
  renderCalendar();
});

// --- SELECT DATE ---
async function selectDate(dateStr) {
  selectedDate = dateStr;
  selectedSlots = [];
  renderCalendar();

  document.getElementById('selected-date-label').textContent = '— ' + formatDateLong(dateStr);
  document.getElementById('step-slots').classList.remove('hidden');
  document.getElementById('step-form').classList.add('hidden');
  document.getElementById('confirm-slots').disabled = true;

  await loadSlots(dateStr);
  document.getElementById('step-slots').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// --- LOAD SLOTS ---
async function loadSlots(dateStr) {
  const grid = document.getElementById('slots-grid');
  grid.innerHTML = '<p style="color:#9ca3af;font-size:14px;padding:8px 0">Se încarcă...</p>';

  try {
    const res = await fetch(`/api/slots/${dateStr}`);
    slotsData = await res.json();
    renderSlots();
  } catch {
    grid.innerHTML = '<p style="color:red;font-size:14px">Eroare la încărcare. Încearcă din nou.</p>';
  }
}

// --- RENDER SLOTS ---
function renderSlots() {
  const grid = document.getElementById('slots-grid');
  grid.innerHTML = '';

  const now = new Date();
  const todayKey = dateKey(now);
  const currentHour = now.getHours();

  slotsData.forEach(slot => {
    const isPast = selectedDate === todayKey && slot.hour <= currentHour;
    const isBooked = !slot.available;
    const isSelected = selectedSlots.includes(slot.hour);

    const btn = document.createElement('button');
    btn.className = 'slot-btn'
      + (isBooked || isPast ? ' booked' : '')
      + (isSelected ? ' selected' : '');
    btn.textContent = `${formatHour(slot.hour)}–${formatHour(slot.hour + 1)}`;
    btn.dataset.hour = slot.hour;
    if (!isBooked && !isPast) btn.addEventListener('click', () => toggleSlot(slot.hour));
    grid.appendChild(btn);
  });

  document.getElementById('confirm-slots').disabled = selectedSlots.length === 0;
}

// --- TOGGLE SLOT ---
function toggleSlot(hour) {
  if (selectedSlots.includes(hour)) {
    selectedSlots = selectedSlots.filter(h => h !== hour);
  } else if (selectedSlots.length === 0) {
    selectedSlots = [hour];
  } else if (selectedSlots.length === 1) {
    const other = selectedSlots[0];
    if (Math.abs(hour - other) === 1) {
      selectedSlots = [Math.min(hour, other), Math.max(hour, other)];
    } else {
      selectedSlots = [hour];
    }
  } else {
    selectedSlots = [hour];
  }
  renderSlots();
  document.getElementById('confirm-slots').disabled = selectedSlots.length === 0;
}

// --- CONFIRM SLOTS ---
document.getElementById('confirm-slots').addEventListener('click', () => {
  const slotStart = Math.min(...selectedSlots);
  const slotEnd   = Math.max(...selectedSlots) + 1;
  const dur = slotEnd - slotStart;
  document.getElementById('booking-summary').innerHTML =
    `📅 <strong>${formatDateLong(selectedDate)}</strong><br>` +
    `⏰ <strong>${formatHour(slotStart)} – ${formatHour(slotEnd)}</strong> &nbsp;(${dur} ${dur === 1 ? 'oră' : 'ore'})`;
  document.getElementById('step-form').classList.remove('hidden');
  document.getElementById('step-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// --- SUBMIT FORM ---
document.getElementById('booking-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('submit-btn');
  btn.disabled = true;
  btn.textContent = 'Se procesează...';

  const slotStart = Math.min(...selectedSlots);
  const slotEnd   = Math.max(...selectedSlots) + 1;

  const body = {
    date: selectedDate,
    slot_start: slotStart,
    slot_end: slotEnd,
    nume:    document.getElementById('nume').value.trim(),
    prenume: document.getElementById('prenume').value.trim(),
    email:   document.getElementById('email').value.trim(),
  };

  try {
    const res = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();

    if (res.ok) {
      document.getElementById('success-summary').innerHTML =
        `📅 <strong>${formatDateLong(selectedDate)}</strong><br>` +
        `⏰ <strong>${formatHour(slotStart)} – ${formatHour(slotEnd)}</strong><br>` +
        `👤 <strong>${body.prenume} ${body.nume}</strong><br>` +
        `📧 ${body.email}`;
      document.getElementById('step-form').classList.add('hidden');
      document.getElementById('step-slots').classList.add('hidden');
      document.getElementById('step-success').classList.remove('hidden');
      document.getElementById('step-success').scrollIntoView({ behavior: 'smooth' });
    } else {
      alert(data.error || 'A apărut o eroare. Încearcă din nou.');
      btn.disabled = false;
      btn.textContent = 'Confirmă rezervarea';
    }
  } catch {
    alert('Eroare de conexiune. Încearcă din nou.');
    btn.disabled = false;
    btn.textContent = 'Confirmă rezervarea';
  }
});

// --- GATE ---
let _accessCode = null;

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    _accessCode = data.accessCode;
  } catch {
    _accessCode = null;
  }
}

async function submitGate() {
  const btn   = document.getElementById('gate-btn');
  const input = document.getElementById('gate-input');
  const error = document.getElementById('gate-error');
  const code  = input.value.trim();

  if (!code) return;
  btn.disabled = true;
  btn.textContent = '...';

  // Reload config in case it wasn't loaded yet
  if (_accessCode === null) await loadConfig();

  const correct = !_accessCode || code === _accessCode;

  if (correct) {
    localStorage.setItem('access_granted', '1');
    showMainContent();
  } else {
    error.textContent = 'Cod incorect. Încearcă din nou.';
    input.value = '';
    input.focus();
    btn.disabled = false;
    btn.textContent = 'Intră';
  }
}

document.getElementById('gate-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') submitGate();
});

function showMainContent() {
  document.getElementById('gate-screen').classList.add('hidden');
  document.getElementById('main-content').classList.add('visible');
}

// Init
loadConfig().then(() => {
  if (!_accessCode || localStorage.getItem('access_granted') === '1') {
    showMainContent();
  }
});
renderCalendar();
