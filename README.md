# 🏐 Sun Tropez Beach Volleyball — Rezervări Online

Aplicație web pentru rezervarea terenului de beach volleyball Sun Tropez din Salicea. Utilizatorii pot vedea disponibilitatea în timp real, selecta ore libere și primi confirmare automată pe email.

**🌐 Live:** [rezervarisuntropez.ro](https://rezervarisuntropez.ro)

---

## Funcționalități

- **Calendar lunar** — vizualizare completă a disponibilității, rezervări posibile în următoarele 14 zile
- **Selectare sloturi** — ore de 1h sau 2h consecutive, maxim 2 ore/zi per persoană
- **Email automat** — confirmare instantă la adresa clientului după rezervare
- **Panou admin** — statistici (azi / săptămână / total), lista rezervărilor pe lună, anulare rezervări
- **Design responsive** — funcționează perfect pe telefon, tabletă și calculator

## Tehnologii

| Categorie | Tehnologie |
|-----------|-----------|
| Backend | Node.js, Express |
| Bază de date | SQLite (built-in `node:sqlite`) |
| Email | Resend API |
| Frontend | HTML, CSS, Vanilla JS |
| Hosting | Railway |
| Domeniu | rezervarisuntropez.ro |

## Structura proiectului

```
suntropez-booking/
├── server.js          # Server Express + API + logică email
├── package.json
├── .env.example       # Variabile de mediu necesare
└── public/
    ├── index.html     # Pagina de rezervare
    ├── style.css      # Stiluri + animații
    ├── app.js         # Calendar, sloturi, formular
    └── admin.html     # Panou de administrare
```

## Instalare locală

```bash
git clone https://github.com/chiraandrei073-ops/suntropez-booking.git
cd suntropez-booking
npm install
cp .env.example .env
# Completează .env cu valorile tale
node server.js
```

Aplicația pornește pe [http://localhost:3000](http://localhost:3000)

## Variabile de mediu

```env
RESEND_API_KEY=re_...          # Cheie API Resend
EMAIL_DOMAIN=rezervarisuntropez.ro
ADMIN_EMAIL=email@exemplu.ro   # Email pentru notificări admin
ADMIN_TOKEN=parola_admin        # Parolă pentru /admin
PORT=3000
```

## Admin

Panoul de administrare este disponibil la `/admin`. Necesită parola setată în `ADMIN_TOKEN`.

Afișează:
- Număr rezervări azi / săptămâna curentă / total
- Lista rezervărilor filtrate pe lună
- Posibilitate de anulare a oricărei rezervări

---

Realizat cu [Claude Code](https://claude.ai/code) 🤖
