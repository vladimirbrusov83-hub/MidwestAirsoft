# Midwest Airsoft — Events Hub

Deployed on Vercel. Auto-deploys on push to `main`.

---

## Project Structure

```
midwest-airsoft/
├── api/
│   ├── events.js          ← Serves events-seed.json to the frontend
│   └── contact.js         ← Contact form (logs + optional Resend email)
├── public/
│   ├── index.html         ← Frontend (fetches /api/events on load)
│   └── events-seed.json   ← Master event data — source of truth
├── scripts/
│   └── fetch-changes.mjs  ← Detects changed field pages, outputs changes-report.json
├── fields.json            ← All 35 scrapable fields (id, name, state, url)
├── field-hashes.json      ← MD5 hashes of last-fetched pages (do not edit manually)
└── vercel.json
```

---

## Weekly Update Workflow

### Step 1 — Detect changes
```bash
node scripts/fetch-changes.mjs
```
Fetches all field pages, compares MD5 hashes to `field-hashes.json`, and extracts
event-relevant text only for fields whose page changed. Writes `changes-report.json`.

### Step 2 — Update events with Claude Code
Open Claude Code in this directory and say:
```
Update events from changes-report.json
```
Claude reads the compact report and edits `public/events-seed.json` directly.

### Step 3 — Push to GitHub
```bash
git add public/events-seed.json field-hashes.json
git commit -m "Weekly update YYYY-MM-DD"
git push
```
Vercel auto-deploys on push.

---

## How it works

- `changes-report.json` is gitignored (temporary file, not committed)
- `field-hashes.json` is committed so hashes persist across sessions
- First run of `fetch-changes.mjs` builds the baseline (all fields show as changed once)
- Subsequent runs: only changed fields appear (~3–6 per week)

---

## Optional: contact form email notifications

Vercel → Project Settings → Environment Variables:

| Variable | Value |
|---|---|
| `RESEND_API_KEY` | Your Resend API key |
| `CONTACT_EMAIL` | Email address to receive contact form submissions |
