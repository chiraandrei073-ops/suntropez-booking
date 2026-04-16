const DAY_NAMES = ['Dum', 'Lun', 'Mar', 'Mie', 'Joi', 'Vin', 'Sâm'];
const MONTH_NAMES = ['ian', 'feb', 'mar', 'apr', 'mai', 'iun', 'iul', 'aug', 'sep', 'oct', 'nov', 'dec'];

let currentWeekStart = getWeekStart(new Date());
let selectedDate = null;
let selectedSlots = [];
let slotsData = [];

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  const diff = (day === 0) ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatHour(h) {
  return `${String(h).padStart(2, '0')}:00`;
}

function formatDateLong(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('ro-RO', { weekday: 'long', day: 'numeric', month: 'long' });
}

// --- RENDER WEEK ---
function renderWeek() {
  const grid = document.getElementById('days-grid');
  const today = new Date(); today.setHours(0,0,0,0);

  const weekEnd = new Date(currentWeekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  document.getElementById('week-label').textContent =
    `${currentWeekStart.getDate()} ${MONTH_NAMES[currentWeekStart.getMonth()]} – ${weekEnd.getDate()} ${MONTH_NAMES[weekEnd.getMonth()]} ${weekEnd.getFullYear()}`;

  grid.innerHTML = '';
  for (let i = 0; i < 7; i++) {
    const d = new Date(currentWeekStart);
    d.setDate(d.getDate() + i);
    const key = dateKey(d);
    const isPast = d < today;
    const isToday = d.getTime() === today.getTime();
    const isSelected = selectedDate === key;

    const btn = document.createElement('button');
    btn.className = 'day-btn' + (isPast ? ' past' : '') + (isToday ? ' today' : '') + (isSelected ? ' selected' : '');
    btn.innerHTML = `<span class="day-name">${DAY_NAMES[d.getDay()]}</span><span class="day-num">${d.getDate()}</span>`;
    if (!isPast) {
      btn.addEventListener('click', () => selectDate(key));
    }
    grid.appendChild(btn);
  }
}

// --- SELECT DATE ---
async function selectDate(dateStr) {
  selectedDate = dateStr;
  selectedSlots = [];
  renderWeek();

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
  grid.innerHTML = '<p style="color:#9ca3af;font-size:14px">Se încarcă...</p>';

  try {
    const res = await fetch(`/api/slots/${dateStr}`);
    slotsData = await res.json();
    renderSlots();
  } catch {
    grid.innerHTML = '<p style="color:red">Eroare la încărcare. Încearcă din nou.</p>';
  }
}

// --- RENDER SLOTS ---
function renderSlots() {
  const grid = document.getElementById('slots-grid');
  grid.innerHTML = '';

  slotsData.forEach(slot => {
    const btn = document.createElement('button');
    btn.className = 'slot-btn' + (!slot.available ? ' booked' : '') + (selectedSlots.includes(slot.hour) ? ' selected' : '');
    btn.textContent = `${formatHour(slot.hour)}–${formatHour(slot.hour + 1)}`;
    btn.dataset.hour = slot.hour;

    if (slot.available) {
      btn.addEventListener('click', () => toggleSlot(slot.hour));
    }
    grid.appendChild(btn);
  });

  document.getElementById('confirm-slots').disabled = selectedSlots.length === 0;
}

// --- TOGGLE SLOT ---
function toggleSlot(hour) {
  if (selectedSlots.includes(hour)) {
    selectedSlots = selectedSlots.filter(h => h !== hour);
  } else {
    if (selectedSlots.length === 0) {
      selectedSlots = [hour];
    } else if (selectedSlots.length === 1) {
      const other = selectedSlots[0];
      if (Math.abs(hour - other) === 1) {
        // Check if slot between them is available
        selectedSlots = [Math.min(hour, other), Math.max(hour, other)];
      } else {
        // Replace selection
        selectedSlots = [hour];
      }
    } else {
      // Reset
      selectedSlots = [hour];
    }
  }
  renderSlots();
  document.getElementById('confirm-slots').disabled = selectedSlots.length === 0;
}

// --- CONFIRM SLOTS ---
document.getElementById('confirm-slots').addEventListener('click', () => {
  const slotStart = Math.min(...selectedSlots);
  const slotEnd = Math.max(...selectedSlots) + 1;
  const summary = `📅 <strong>${formatDateLong(selectedDate)}</strong><br>⏰ <strong>${formatHour(slotStart)} – ${formatHour(slotEnd)}</strong> (${slotEnd - slotStart} ${slotEnd - slotStart === 1 ? 'oră' : 'ore'})`;
  document.getElementById('booking-summary').innerHTML = summary;
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
  const slotEnd = Math.max(...selectedSlots) + 1;

  const body = {
    date: selectedDate,
    slot_start: slotStart,
    slot_end: slotEnd,
    nume: document.getElementById('nume').value.trim(),
    prenume: document.getElementById('prenume').value.trim(),
    email: document.getElementById('email').value.trim(),
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
        `📅 <strong>${formatDateLong(selectedDate)}</strong><br>⏰ <strong>${formatHour(slotStart)} – ${formatHour(slotEnd)}</strong><br>👤 <strong>${body.prenume} ${body.nume}</strong><br>📧 ${body.email}`;
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

// --- WEEK NAV ---
document.getElementById('prev-week').addEventListener('click', () => {
  const today = new Date(); today.setHours(0,0,0,0);
  const prev = new Date(currentWeekStart);
  prev.setDate(prev.getDate() - 7);
  if (prev >= getWeekStart(today)) {
    currentWeekStart = prev;
    renderWeek();
  }
});

document.getElementById('next-week').addEventListener('click', () => {
  currentWeekStart.setDate(currentWeekStart.getDate() + 7);
  renderWeek();
});

// Init
renderWeek();
