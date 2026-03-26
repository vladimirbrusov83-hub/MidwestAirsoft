# Midwest Airsoft — Events Hub

Deployed on Vercel. Events are updated manually once a week.

---

## Project Structure

```
midwest-airsoft/
├── api/
│   ├── contact.js     ← Contact form endpoint
│   └── events.js      ← Public endpoint: serves events data to the frontend
├── public/
│   ├── index.html     ← Frontend (fetches /api/events on load)
│   └── events-seed.json ← Event data — edit this to update the site
├── vercel.json
└── package.json
```

---

## How to update events (weekly)

1. Edit `public/events-seed.json` with the latest events
2. Push to GitHub — Vercel auto-deploys

---

## Setup

```bash
npm i -g vercel
cd midwest-airsoft
vercel deploy --prod
```

### Optional: email notifications for contact form

Go to: vercel.com → Your project → Settings → Environment Variables

| Variable | Value |
|---|---|
| `RESEND_API_KEY` | Your Resend API key |
| `CONTACT_EMAIL` | Email address to receive contact submissions |
