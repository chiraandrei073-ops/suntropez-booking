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

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// GET access code config (used by frontend for comparison)
app.get('/api/config', (req, res) => {
  const code = (process.env.ACCESS_CODE || '').trim().replace(/^["']|["']$/g, '');
  res.json({ accessCode: code || null });
});

// GET available slots for a date
app.get('/api/slots/:date', (req, res) => {
  const { date } = req.params;
  const booked = db.prepare('SELECT slot_start, slot_end FROM bookings WHERE date = ?').all(date);

  const bookedHours = new Set();
  booked.forEach(b => {
    for (let h = b.slot_start; h < b.slot_end; h++) bookedHours.add(h);
  });

  const slots = [];
  for (let h = 8; h <= 20; h++) {
    slots.push({ hour: h, available: !bookedHours.has(h) });
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
  if (slot_start < 8 || slot_end > 21 || slot_end <= slot_start) {
    return res.status(400).json({ error: 'Interval orar invalid.' });
  }

  // Block past hours on today
  const todayStr = new Date().toISOString().slice(0, 10);
  const currentHour = new Date().getHours();
  if (date === todayStr && slot_start <= currentHour) {
    return res.status(400).json({ error: 'Nu poți rezerva ore din trecut.' });
  }
  if (date < todayStr) {
    return res.status(400).json({ error: 'Nu poți rezerva date din trecut.' });
  }
  if (slot_end - slot_start > 2) {
    return res.status(400).json({ error: 'Maxim 2 ore per rezervare.' });
  }

  // Check if same email already has 2h that day
  const existingHours = db.prepare(
    'SELECT SUM(slot_end - slot_start) as total FROM bookings WHERE date = ? AND lower(email) = lower(?)'
  ).get(date, email);
  if (existingHours.total && existingHours.total + (slot_end - slot_start) > 2) {
    return res.status(400).json({ error: 'Ai atins limita de 2 ore pe zi pentru această adresă de email.' });
  }

  // Check slot availability
  const booked = db.prepare('SELECT slot_start, slot_end FROM bookings WHERE date = ?').all(date);
  const bookedHours = new Set();
  booked.forEach(b => {
    for (let h = b.slot_start; h < b.slot_end; h++) bookedHours.add(h);
  });
  for (let h = slot_start; h < slot_end; h++) {
    if (bookedHours.has(h)) {
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
    const pad = h => `${String(h).padStart(2, '0')}:00`;
    const from = `Sun Tropez Beach Volleyball <noreply@${process.env.EMAIL_DOMAIN}>`;
    const dateFormatted = new Date(date + 'T12:00:00').toLocaleDateString('ro-RO', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    const dur = slot_end - slot_start;
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
            <p style="margin: 0;"><strong>⏱ Durată:</strong> ${dur} ${dur === 1 ? 'oră' : 'ore'}</p>
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

    // Notification to admin
    if (ADMIN_EMAIL) {
      resend.emails.send({
        from, to: ADMIN_EMAIL,
        subject: `Rezervare nouă: ${prenume} ${nume} – ${date}`,
        html: `<p>Rezervare nouă:</p><ul>
          <li><strong>Nume:</strong> ${prenume} ${nume}</li>
          <li><strong>Email:</strong> ${email}</li>
          <li><strong>Data:</strong> ${date}</li>
          <li><strong>Ora:</strong> ${pad(slot_start)} – ${pad(slot_end)}</li></ul>`
      })
        .then(r => r.error
          ? console.error('[EMAIL] Eroare admin:', JSON.stringify(r.error))
          : console.log('[EMAIL] Notificare admin trimisă.'))
        .catch(err => console.error('[EMAIL] Excepție admin:', err.message));
    }
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
  const weekStartStr = weekStart.toISOString().slice(0, 10);

  const total  = db.prepare('SELECT COUNT(*) as n FROM bookings').get().n;
  const todayN = db.prepare('SELECT COUNT(*) as n FROM bookings WHERE date = ?').get(todayStr).n;
  const weekN  = db.prepare('SELECT COUNT(*) as n FROM bookings WHERE date >= ?').get(weekStartStr).n;
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
    const pad = h => `${String(h).padStart(2, '0')}:00`;
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
