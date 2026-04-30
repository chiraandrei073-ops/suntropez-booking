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

function formatTime(m) {
  return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
}

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h} ${h === 1 ? 'oră' : 'ore'}`;
  return `${h}h ${m}min`;
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
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const isToday = selectedDate === todayKey;

  slotsData.forEach(slot => {
    const isPast = isToday && slot.hour <= nowMinutes;
    const isBooked = !slot.available;
    const isSelected = selectedSlots.includes(slot.hour);

    const btn = document.createElement('button');
    btn.className = 'slot-btn'
      + (isBooked || isPast ? ' booked' : '')
      + (isSelected ? ' selected' : '');
    btn.textContent = `${formatTime(slot.hour)}–${formatTime(slot.hour + 30)}`;
    btn.dataset.hour = slot.hour;
    if (!isBooked && !isPast) btn.addEventListener('click', () => toggleSlot(slot.hour));
    grid.appendChild(btn);
  });

  document.getElementById('confirm-slots').disabled = selectedSlots.length === 0;
}

// --- TOGGLE SLOT ---
function toggleSlot(hour) {
  // Verificare în timp real — nu permite sloturi din trecut
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  if (selectedDate === dateKey(now) && hour <= nowMinutes) {
    renderSlots();
    return;
  }
  if (selectedSlots.includes(hour)) {
    selectedSlots = selectedSlots.filter(h => h !== hour);
  } else if (selectedSlots.length === 0) {
    selectedSlots = [hour];
  } else {
    const minS = Math.min(...selectedSlots);
    const maxS = Math.max(...selectedSlots);
    if (hour === minS - 30) {
      selectedSlots = [hour, ...selectedSlots];
    } else if (hour === maxS + 30) {
      selectedSlots = [...selectedSlots, hour];
    } else {
      selectedSlots = [hour];
    }
  }
  renderSlots();
  document.getElementById('confirm-slots').disabled = selectedSlots.length === 0;
}

// --- CONFIRM SLOTS ---
document.getElementById('confirm-slots').addEventListener('click', () => {
  const slotStart = Math.min(...selectedSlots);
  const slotEnd   = Math.max(...selectedSlots) + 30;
  document.getElementById('booking-summary').innerHTML =
    `📅 <strong>${formatDateLong(selectedDate)}</strong><br>` +
    `⏰ <strong>${formatTime(slotStart)} – ${formatTime(slotEnd)}</strong> &nbsp;(${formatDuration(slotEnd - slotStart)})`;
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
  const slotEnd   = Math.max(...selectedSlots) + 30;

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
        `⏰ <strong>${formatTime(slotStart)} – ${formatTime(slotEnd)}</strong><br>` +
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

// Auto-refresh sloturi în fiecare minut (pentru ziua curentă)
setInterval(() => {
  if (selectedDate && selectedDate === dateKey(new Date())) {
    renderSlots();
  }
}, 60000);

// Init
renderCalendar();
