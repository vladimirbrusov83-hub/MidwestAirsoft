# Midwest Airsoft Hub — Claude Instructions

## Project Overview

Public directory of 35 airsoft fields across 7 Midwest states (IL, MN, WI, IN, MO, MI, OH) with upcoming events. Updated weekly.

- **Live:** https://www.midwestairsoft.space
- **Stack:** Vanilla JS single `public/index.html` (~3362 lines) + 2 Vercel serverless functions. No database, no framework, no build step.
- **Data:** `public/events-seed.json` — flat JSON file committed to git. This IS the database.

## How to Deploy

```
git add . && git commit -m "..." && git push
```

Vercel auto-deploys in ~30s. No env vars needed for core functionality (only for contact email).

## Rules

- **No framework, no npm, no build tools.**
- **`events-seed.json` is the only data source.** Edit it to change what the site shows.
- **Don't touch `field-hashes.json`** — it's state for the change detector, not site data.
- Don't refactor for its own sake. Fix what's asked.

## File Map

```
MidwestAirsoft/
├── public/
│   ├── index.html          ← entire frontend (~3362 lines)
│   └── events-seed.json    ← SOURCE OF TRUTH — all field + event data
├── api/
│   ├── events.js           ← GET /api/events — serves events-seed.json (1h CDN cache)
│   └── contact.js          ← POST /api/contact — logs + optional Resend email
├── scripts/
│   └── fetch-changes.mjs   ← weekly scraper — writes changes-report.json
├── fields.json             ← master field list (used by fetch-changes only)
├── field-hashes.json       ← MD5 hashes for change detection (do not edit)
├── update.mjs              ← interactive CLI for manual event add/remove
├── local-update-guide.md   ← step-by-step weekly update guide
└── vercel.json             ← function max durations (10s each)
```

## Data Structures

### `events-seed.json` (top level)
```json
{
  "lastUpdated": "2026-04-07T00:00:00.000Z",
  "nextUpdate": "2026-04-14T00:00:00.000Z",
  "fields": [...],
  "events": [...]
}
```

### Field object
```json
{
  "id": "twincities",
  "name": "Twin Cities Airsoft (TCA)",
  "location": "Minneapolis/St. Paul Metro, MN",
  "state": "MN",
  "description": "...",
  "tags": ["Outdoor", "Scenario Games"],
  "url": "https://www.twincitiesairsoft.com/"
}
```

### Event object
```json
{
  "date": "2026-05-10",
  "name": "Big Spring Game",
  "type": "milsim",
  "price": "$30",
  "url": "https://...",
  "venue": "Bing Field · Alton, IL",
  "state": "IL",
  "badge": "MilSim",
  "fieldId": "bingfield",
  "fieldName": "Bing Field",
  "location": "Alton, IL"
}
```
Event `type`: `milsim` | `big` | `open`. `badge` is optional label override.

### Recurring event extras
```json
{
  "date": "recurring",
  "recurringLabel": "Bi-Weekly",
  "recurringDay": "∞",
  "base": true
}
```

## API Routes

### `GET /api/events`
Static import of `events-seed.json`. Returns full JSON. Headers: `Cache-Control: s-maxage=3600, stale-while-revalidate=86400`.

### `POST /api/contact`
Fields: `name`, `email` (optional), `type`, `state` (optional), `message`. Always logs to Vercel. Sends email if `RESEND_API_KEY` + `CONTACT_EMAIL` env vars are set.

**Contact form details (`api/contact.js`):**
- Required fields: `name`, `type`, `message` — returns 400 if missing
- Optional fields: `email`, `state`
- Always writes a log line to Vercel function logs (works even without email configured)
- Email provider: **Resend** (`https://api.resend.com/emails`)
- Sender: `Midwest Airsoft Hub <onboarding@resend.dev>`
- Subject format: `[MidwestAirsoft] {TYPE} submission — {STATE}`

**To activate email delivery, set these two Vercel env vars:**
```
RESEND_API_KEY   ← API key from resend.com
CONTACT_EMAIL    ← recipient email address
```
Without these, submissions are logged only — no email is sent.

**Form UX** (in `public/index.html`):
- Type dropdown: New Field / Upcoming Event / Correction / Update / Other
- State dropdown: IL / MN / WI / IN / MO / MI / OH / Other
- Submit button: "Transmit →" / loading: "Transmitting…"
- Success: "// Intel received. Thanks for the report."
- Error: "// Transmission failed. Try again."

## CSS Theme

Military dark aesthetic.
```css
--bg:     #070a06   /* near-black */
--green:  #c8f032   /* acid green — primary accent */
--red:    #bf2e08   /* milsim red */
--amber:  #c99010   /* warning amber */
--text:   #b0c880   /* muted green text */
--white:  #e4ecd4   /* bright text */
```

Decorative effects (CSS only): scanlines overlay (`body::after`), atmospheric glow (`body::before`), `clip-path: polygon(...)` angled corners on cards/buttons, tactical grid header background.

Fonts: Bebas Neue (headers) · Barlow Condensed (nav) · DM Mono (labels) · Barlow (body)

## Key JS Functions

- **`filterState(state, btn)`** — filters `.field-card` by `data-state`, syncs map + mobile tiles
- **`evFilter(type, val, btn)`** — sets event filter state, calls `applyEvFilters()`
- **`applyEvFilters()`** — shows/hides `.event-row` by state + month
- **`mapFilterState(state)`** — SVG map click → syncs field + event filters
- **`loadEvents()` (IIFE)** — fetches `/api/events`, filters past events, sorts (recurring first then chrono), renders `#events-list`

## Weekly Update Workflow

GitHub Action runs every Wednesday at 10 AM and auto-commits `changes-report.json`.

```bash
git pull
# changes-report.json is already here from the Action
# Tell Claude: "Update events from changes-report.json"
git add public/events-seed.json field-hashes.json
git commit -m "Weekly update YYYY-MM-DD"
git push
```

**Manual scrape (if needed):**
```bash
node scripts/fetch-changes.mjs
```
Reset baseline (force re-check all fields): `rm field-hashes.json && node scripts/fetch-changes.mjs`

**Interactive CLI:**
```bash
node update.mjs   # menu: add/remove/edit events, save & push
```

### IMPORTANT: Token-efficient update process — exactly 3 node -e commands

**DO NOT** read `events-seed.json` or `changes-report.json` into context. **DO NOT** print raw text for all changed fields. **DO NOT** run exploratory queries to understand data structure (it doesn't change). **DO NOT** read `local-update-guide.md` — this file has everything.

**Step 1** — Filter to event-rich fields only (skip empties):
```js
node -e "
const r = JSON.parse(require('fs').readFileSync('./changes-report.json'));
r.changed.filter(f => f.text.length > 300 || /\d{4}/.test(f.text))
  .forEach(f => console.log('---', f.name, f.state, '---\n', f.text.substring(0, 600)));
"
```

**Step 2** — Check existing future events for just those fields (one query, by venue keywords or state):
```js
node -e "
const d = JSON.parse(require('fs').readFileSync('./public/events-seed.json'));
const today = new Date().toISOString().split('T')[0];
d.events.filter(e => e.date >= today || e.date === 'recurring')
  .filter(e => /* venue keywords from step 1 */)
  .forEach(e => console.log(e.date, '|', e.name, '|', e.venue));
"
```

**Step 3** — One update pass: remove past events + add new ones + write file:
```js
node -e "
const fs = require('fs'), path = './public/events-seed.json';
const data = JSON.parse(fs.readFileSync(path));
const today = new Date().toISOString().split('T')[0];
data.events = data.events.filter(e => e.date === 'recurring' || e.date >= today);
// push new events here...
data.lastUpdated = new Date().toISOString();
data.nextUpdate = new Date(Date.now() + 7*24*60*60*1000).toISOString();
fs.writeFileSync(path, JSON.stringify(data, null, 2));
"
```

Then commit:
```bash
git diff --stat
git add public/events-seed.json && git commit -m "Weekly update YYYY-MM-DD" && git push
```

## How to Add a New Field

1. Add to `fields.json` (change detector uses this)
2. Add to `public/events-seed.json` → `fields[]` array (shown on site)
3. Add state filter button in `index.html` if it's a new state
4. Add SVG map path if it's a new state
5. `git push`
