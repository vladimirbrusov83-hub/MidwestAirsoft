# Midwest Airsoft — Auto-Refreshing Events Hub

Deployed on Vercel. Scrapes field websites every Monday at 6am UTC using Claude API for parsing.

---

## Project Structure

```
midwest-airsoft/
├── api/
│   ├── scrape.js      ← Cron function: fetches sites, parses with Claude, stores data
│   └── events.js      ← Public endpoint: serves latest events.json to the frontend
├── public/
│   ├── index.html     ← Frontend (fetches /api/events on load)
│   └── events-seed.json ← Fallback data shown before first scrape
├── vercel.json        ← Cron schedule: every Monday 6am UTC
└── package.json
```

---

## Setup (15 minutes)

### 1. Clone & deploy

```bash
# Install Vercel CLI if you don't have it
npm i -g vercel

# From the project folder
cd midwest-airsoft
vercel deploy --prod
```

### 2. Set environment variables in Vercel dashboard

Go to: vercel.com → Your project → Settings → Environment Variables

| Variable | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key (sk-ant-...) |
| `CRON_SECRET` | Any random string, e.g. `airsoft2026xyz` |

### 3. Add Vercel KV (free, needed for data persistence)

Vercel's serverless functions don't persist files between runs.
KV stores the scraped data so the frontend always has fresh data.

```bash
# In your project on vercel.com:
# Storage → Create → KV → Connect to project
# This auto-adds KV_REST_API_URL and KV_REST_API_TOKEN env vars
```

Then update `api/scrape.js` — find the comment `// ── Write to Vercel KV ──`
and uncomment the KV write block (it's already in the file, just commented out).

### 4. Trigger first scrape manually

After deploying, visit:
```
https://your-project.vercel.app/api/scrape?secret=YOUR_CRON_SECRET
```

This runs the scraper immediately so you don't wait until Monday.

---

## How it works

```
Every Monday 6am UTC
       │
       ▼
vercel.json cron → GET /api/scrape
       │
       ▼
For each field website:
  1. fetch() raw HTML
  2. Strip tags → plain text
  3. Send to Claude Haiku API → structured JSON events
       │
       ▼
Merge all events, sort by date, remove past events
       │
       ▼
Write to Vercel KV store
       │
       ▼
Frontend hits GET /api/events → reads from KV → renders page
```

---

## Adding more fields

Edit `SOURCES` array in `api/scrape.js`:

```js
{
  id: "myfield",              // unique slug
  name: "My Airsoft Field",
  location: "City, ST",
  state: "IL",               // two-letter state code
  url: "https://myfield.com/events",  // page with event listings
  siteUrl: "https://myfield.com/",    // main site URL
  tags: ["Outdoor", "MilSim"],
},
```

Also add it to `STATIC_FIELDS` in the same file so it appears in the fields grid even if no events are found.

---

## Manual refresh

Trigger a fresh scrape any time:
```
GET https://your-site.vercel.app/api/scrape?secret=YOUR_CRON_SECRET
```

The frontend also has a **↻ Refresh** button that re-fetches from `/api/events`.

---

## Cost

- **Vercel**: Free (Hobby plan covers cron + serverless functions)
- **Claude API**: ~$0.01–0.05 per weekly scrape (uses Haiku, cheapest model)
- **Vercel KV**: Free up to 30k commands/month

Total: essentially **free**.

---

## Cron schedule

Defined in `vercel.json`:
```json
{ "path": "/api/scrape", "schedule": "0 6 * * 1" }
```
= Every Monday at 06:00 UTC. Change to any [cron expression](https://crontab.guru).
