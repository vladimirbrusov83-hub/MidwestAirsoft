# Midwest Airsoft Hub — Claude Instructions

## Project Overview

Public directory of 35 airsoft fields across 7 Midwest states (IL, MN, WI, IN, MO, MI, OH) with upcoming events. Updated weekly.

- **Live:** https://www.midwestairsoft.space
- **Stack:** Vanilla JS single `public/index.html` (~3362 lines) + 2 Vercel serverless functions. No database, no framework, no build step.
- **Data:** `public/events-seed.json` — flat JSON file committed to git. This IS the database.

Full data schema (events-seed.json, field/event objects, API routes, CSS theme, key JS functions) is in `docs/data-format.md` — read it before editing data or the frontend.

@docs/data-format.md

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
├── fields.json             ← THE field list: site cards, map pins, scanner, event lookups
├── field-hashes.json       ← MD5 hashes for change detection (do not edit)
├── update.mjs              ← interactive CLI for manual event add/remove
├── docs/data-format.md     ← data schema + API + theme reference
└── vercel.json             ← function max durations (10s each)
```

## Weekly Update Workflow

Use the `/airsoft-update` command — it runs the token-efficient 3-command process described there.

GitHub Action runs every Wednesday at 10 AM and auto-commits `changes-report.json`. Manual scrape if needed: `node scripts/fetch-changes.mjs` (reset baseline: `rm field-hashes.json && node scripts/fetch-changes.mjs`). Interactive CLI for manual add/remove/edit: `node update.mjs`.

## How to Add a New Field

`fields.json` is the one field list. The cards in `index.html` (between `FIELDS:START`/`FIELDS:END`) are generated from it — never hand-edit them.

1. Add an entry to `fields.json`: `id, name, state, location, lat, lng, tags, description, url` (+ `rentals: true` if it rents gear). Facebook-only / unscannable → `"scan": false`; scanner should check a different page than the card link → `"scanUrl"`; JS-built page → `"render": true`.
2. `node scripts/build-fields.mjs` (rewrites the cards; fails loudly if lat/lng is missing)
3. New state only: add its filter button + map path in `index.html`
4. `git add fields.json public/index.html && git commit && git push`

Other keys: `card: false` = kept for event lookups but not shown on the site. Changing a scanned field's `id` or scan URL resets its change hash.
