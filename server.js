require('dotenv').config();
const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const { Resend } = require('resend');
const path = require('path');

const app = express();

const dbPath = process.env.DB_PATH || 'bookings.db';
console.log('[DB] Folosesc baza de date la:', dbPath);
let db;
try {
  db = new DatabaseSync(dbPath);
} catch (err) {
  console.error('[DB] Eroare la deschiderea bazei de date:', err.message);
  console.error('[DB] Încerc fallback la bookings.db local...');
  db = new DatabaseSync('bookings.db');
}

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';

function getResend() {
  if (!process.env.RESEND_API_KEY) return null;
  return new Resend(process.env.RESEND_API_KEY);
}

// Setup DB
db.exec(`
  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    slot_start INTEGER NOT NULL,
    slot_end INTEGER NOT NULL,
    nume TEXT NOT NULL,
    prenume TEXT NOT NULL,
    email TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

// Migrare date vechi: slot_start/slot_end în ore → minute (o singură dată)
const oldBookings = db.prepare('SELECT id, slot_start, slot_end FROM bookings WHERE slot_start < 100').all();
if (oldBookings.length > 0) {
  const upd = db.prepare('UPDATE bookings SET slot_start = ?, slot_end = ? WHERE id = ?');
  oldBookings.forEach(b => upd.run(b.slot_start * 60, b.slot_end * 60, b.id));
  console.log(`[DB] Migrat ${oldBookings.length} rezervări din ore în minute.`);
}

app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

// GET available slots for a date
app.get('/api/slots/:date', (req, res) => {
  const { date } = req.params;
  const booked = db.prepare('SELECT slot_start, slot_end FROM bookings WHERE date = ?').all(date);

  const bookedMinutes = new Set();
  booked.forEach(b => {
    for (let m = b.slot_start; m < b.slot_end; m += 30) bookedMinutes.add(m);
  });

  const slots = [];
  for (let m = 480; m < 1260; m += 30) { // 08:00 → 20:30 (ultimul slot 20:30–21:00)
    slots.push({ hour: m, available: !bookedMinutes.has(m) });
  }
  res.json(slots);
});

// POST create booking
app.post('/api/bookings', async (req, res) => {
  const { date, slot_start, slot_end, nume, prenume, email } = req.body;

  // Validate
  if (!date || slot_start == null || slot_end == null || !nume || !prenume || !email) {
    return res.status(400).json({ error: 'Toate câmpurile sunt obligatorii.' });
  }
  // slot_start/slot_end sunt în minute de la miezul nopții (ex: 540 = 09:00, 570 = 09:30)
  if (slot_start < 480 || slot_end > 1260 || slot_end <= slot_start || (slot_start % 30 !== 0) || (slot_end % 30 !== 0)) {
    return res.status(400).json({ error: 'Interval orar invalid.' });
  }

  // Block past slots on today
  const todayStr = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  if (date === todayStr && slot_start <= nowMinutes) {
    return res.status(400).json({ error: 'Nu poți rezerva ore din trecut.' });
  }
  if (date < todayStr) {
    return res.status(400).json({ error: 'Nu poți rezerva date din trecut.' });
  }

  // Check slot availability
  const booked = db.prepare('SELECT slot_start, slot_end FROM bookings WHERE date = ?').all(date);
  const bookedMinutes = new Set();
  booked.forEach(b => {
    for (let m = b.slot_start; m < b.slot_end; m += 30) bookedMinutes.add(m);
  });
  for (let m = slot_start; m < slot_end; m += 30) {
    if (bookedMinutes.has(m)) {
      return res.status(409).json({ error: 'Unul sau mai multe sloturi sunt deja rezervate.' });
    }
  }

  // Save booking
  const result = db.prepare(
    'INSERT INTO bookings (date, slot_start, slot_end, nume, prenume, email) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(date, slot_start, slot_end, nume, prenume, email);

  // Respond immediately — email se trimite în fundal
  res.json({ success: true, id: result.lastInsertRowid });

  // Send emails async (non-blocking)
  const resend = getResend();
  if (!resend) {
    console.warn('[EMAIL] RESEND_API_KEY lipsește — emailul nu a fost trimis.');
  } else {
    const pad = m => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
    const from = `Sun Tropez Beach Volleyball <noreply@${process.env.EMAIL_DOMAIN}>`;
    const dateFormatted = new Date(date + 'T12:00:00').toLocaleDateString('ro-RO', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    const durMin = slot_end - slot_start;
    const durH = Math.floor(durMin / 60);
    const durM = durMin % 60;
    const durStr = durH > 0 && durM > 0 ? `${durH}h ${durM}min` : durH > 0 ? `${durH} ${durH === 1 ? 'oră' : 'ore'}` : `${durM} min`;
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; background: #fff8f0; border-radius: 12px; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #f97316, #fb923c); padding: 32px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px;">🏐 Rezervare confirmată!</h1>
          <p style="color: #fff3e0; margin: 8px 0 0;">Sun Tropez Beach Volleyball</p>
        </div>
        <div style="padding: 32px;">
          <p style="font-size: 16px; color: #374151;">Salut <strong>${prenume} ${nume}</strong>,</p>
          <p style="color: #6b7280;">Rezervarea ta a fost înregistrată cu succes!</p>
          <div style="background: white; border-radius: 8px; padding: 20px; margin: 24px 0; border-left: 4px solid #f97316;">
            <p style="margin: 0 0 8px;"><strong>📅 Data:</strong> ${dateFormatted}</p>
            <p style="margin: 0 0 8px;"><strong>⏰ Ora:</strong> ${pad(slot_start)} – ${pad(slot_end)}</p>
            <p style="margin: 0;"><strong>⏱ Durată:</strong> ${durStr}</p>
          </div>
          <p style="color: #6b7280; font-size: 14px;">Ne vedem pe teren! Dacă ai întrebări, ne poți contacta direct.</p>
          <p style="color: #6b7280; font-size: 14px;">— Echipa Sun Tropez 🌴</p>
        </div>
      </div>
    `;

    // Confirmation to client
    resend.emails.send({ from, to: email, subject: 'Confirmare rezervare teren - Sun Tropez Beach Volleyball', html: emailHtml })
      .then(r => r.error
        ? console.error('[EMAIL] Eroare confirmare:', JSON.stringify(r.error))
        : console.log('[EMAIL] Confirmare trimisă către', email, '| id:', r.data?.id))
      .catch(err => console.error('[EMAIL] Excepție confirmare:', err.message));

  }

});

// Admin page route
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// GET all bookings (admin) — optional ?month=YYYY-MM filter
app.get('/api/admin/bookings', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Neautorizat.' });
  }
  const { month } = req.query;
  let bookings;
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    bookings = db.prepare(
      "SELECT * FROM bookings WHERE strftime('%Y-%m', date) = ? ORDER BY date ASC, slot_start ASC"
    ).all(month);
  } else {
    bookings = db.prepare(
      'SELECT * FROM bookings ORDER BY date ASC, slot_start ASC'
    ).all();
  }
  res.json(bookings);
});

// GET stats (admin)
app.get('/api/admin/stats', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Neautorizat.' });
  }
  const todayStr = new Date().toISOString().slice(0, 10);
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + (weekStart.getDay() === 0 ? -6 : 1));
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  const weekStartStr = weekStart.toISOString().slice(0, 10);
  const weekEndStr   = weekEnd.toISOString().slice(0, 10);

  const total  = db.prepare('SELECT COUNT(*) as n FROM bookings').get().n;
  const todayN = db.prepare('SELECT COUNT(*) as n FROM bookings WHERE date = ?').get(todayStr).n;
  const weekN  = db.prepare('SELECT COUNT(*) as n FROM bookings WHERE date >= ? AND date <= ?').get(weekStartStr, weekEndStr).n;
  res.json({ total, today: todayN, week: weekN });
});

// DELETE booking (admin)
app.delete('/api/admin/bookings/:id', async (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Neautorizat.' });
  }

  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Rezervarea nu există.' });

  db.prepare('DELETE FROM bookings WHERE id = ?').run(req.params.id);
  res.json({ success: true });

  // Send cancellation email async
  const resend = getResend();
  if (resend && booking.email) {
    const pad = m => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
    const dateFormatted = new Date(booking.date + 'T12:00:00').toLocaleDateString('ro-RO', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    resend.emails.send({
      from: `Sun Tropez Beach Volleyball <noreply@${process.env.EMAIL_DOMAIN}>`,
      to: booking.email,
      subject: 'Rezervare anulată - Sun Tropez Beach Volleyball',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; background: #fef2f2; border-radius: 12px; overflow: hidden;">
          <div style="background: linear-gradient(135deg, #dc2626, #ef4444); padding: 32px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">Rezervare anulată</h1>
            <p style="color: #fee2e2; margin: 8px 0 0;">Sun Tropez Beach Volleyball</p>
          </div>
          <div style="padding: 32px;">
            <p style="font-size: 16px; color: #374151;">Salut <strong>${booking.prenume} ${booking.nume}</strong>,</p>
            <p style="color: #6b7280;">Ne pare rău, rezervarea ta a fost anulată.</p>
            <div style="background: white; border-radius: 8px; padding: 20px; margin: 24px 0; border-left: 4px solid #ef4444;">
              <p style="margin: 0 0 8px;"><strong>📅 Data:</strong> ${dateFormatted}</p>
              <p style="margin: 0;"><strong>⏰ Ora:</strong> ${pad(booking.slot_start)} – ${pad(booking.slot_end)}</p>
            </div>
            <p style="color: #6b7280; font-size: 14px;">Pentru informații suplimentare, ne poți contacta direct.</p>
            <p style="color: #6b7280; font-size: 14px;">— Echipa Sun Tropez 🌴</p>
          </div>
        </div>
      `
    })
      .then(r => r.error
        ? console.error('[EMAIL] Eroare anulare:', JSON.stringify(r.error))
        : console.log('[EMAIL] Anulare trimisă către', booking.email))
      .catch(err => console.error('[EMAIL] Excepție anulare:', err.message));
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server pornit pe http://localhost:${PORT}`));
