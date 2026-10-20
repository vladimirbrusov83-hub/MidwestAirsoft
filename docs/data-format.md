# MidwestAirsoft — Data Format & API Reference

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

### Field object (root `fields.json` — no longer in events-seed.json; see CLAUDE.md "How to Add a New Field")
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
