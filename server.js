require('dotenv').config();
const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const { Resend } = require('resend');
const path = require('path');

const app = express();
const db = new DatabaseSync('bookings.db');

function getResend() {
  if (!process.env.RESEND_API_KEY) return null;
  return new Resend(process.env.RESEND_API_KEY);
}

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';

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

// Helper wrappers
const dbAll = (sql, ...params) => db.prepare(sql).all(...params);
const dbGet = (sql, ...params) => db.prepare(sql).get(...params);
const dbRun = (sql, ...params) => db.prepare(sql).run(...params);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

  // Send confirmation email
  try {
    const resend = getResend();
    if (!resend) { console.warn('RESEND_API_KEY lipsește — emailul nu a fost trimis.'); }
    const formatHour = h => `${String(h).padStart(2, '0')}:00`;
    const dateFormatted = new Date(date + 'T12:00:00').toLocaleDateString('ro-RO', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    if (resend) await resend.emails.send({
      from: `Sun Tropez Beach Volleyball <rezervari@${process.env.EMAIL_DOMAIN || 'rezervarisuntropez.ro'}>`,
      to: email,
      subject: 'Confirmare rezervare teren - Sun Tropez Beach Volleyball',
      html: `
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
              <p style="margin: 0 0 8px;"><strong>⏰ Ora:</strong> ${formatHour(slot_start)} - ${formatHour(slot_end)}</p>
              <p style="margin: 0;"><strong>⏱ Durată:</strong> ${slot_end - slot_start} ${slot_end - slot_start === 1 ? 'oră' : 'ore'}</p>
            </div>
            <p style="color: #6b7280; font-size: 14px;">Ne vedem pe teren! Dacă ai întrebări, ne poți contacta direct.</p>
            <p style="color: #6b7280; font-size: 14px;">— Echipa Sun Tropez 🌴</p>
          </div>
        </div>
      `
    });

    // Notify admin
    if (resend) await resend.emails.send({
      from: `Sun Tropez Rezervări <rezervari@${process.env.EMAIL_DOMAIN || 'rezervarisuntropez.ro'}>`,
      to: ADMIN_EMAIL,
      subject: `Rezervare nouă: ${prenume} ${nume} - ${date}`,
      html: `
        <p>Rezervare nouă înregistrată:</p>
        <ul>
          <li><strong>Nume:</strong> ${prenume} ${nume}</li>
          <li><strong>Email:</strong> ${email}</li>
          <li><strong>Data:</strong> ${date}</li>
          <li><strong>Ora:</strong> ${formatHour(slot_start)} - ${formatHour(slot_end)}</li>
        </ul>
      `
    });
  } catch (err) {
    console.error('Email error:', err.message);
  }

  res.json({ success: true, id: result.lastInsertRowid });
});

// GET all bookings (admin - protected by token)
app.get('/api/admin/bookings', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Neautorizat.' });
  }
  const bookings = db.prepare(
    'SELECT * FROM bookings ORDER BY date DESC, slot_start ASC'
  ).all();
  res.json(bookings);
});

// DELETE booking (admin)
app.delete('/api/admin/bookings/:id', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Neautorizat.' });
  }
  db.prepare('DELETE FROM bookings WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server pornit pe http://localhost:${PORT}`));
