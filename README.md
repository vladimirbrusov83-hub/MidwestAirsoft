# Midwest Airsoft — Fields & Events Hub

A weekly-updated directory of airsoft fields and events across the Midwest — Illinois, Minnesota, Wisconsin, Indiana, Missouri, Michigan, and Ohio.

Live: **[midwestairsoft.space](https://www.midwestairsoft.space)**

---

## What it does

One place to find airsoft fields and upcoming events in the Midwest. MilSim ops, big games, open play days — updated every week.

35 fields tracked across 7 states. The site checks each field's page for changes, pulls out event info, and updates the listings.

---

## How it stays updated

The update process is semi-automated and runs weekly in three steps:

**Step 1 — Detect changes**
```bash
node scripts/fetch-changes.mjs
```
Checks all 35 field pages, finds which ones changed since last week, pulls out the relevant event text. Saves results to `changes-report.json`.

**Step 2 — Update the event listings**

Open Claude Code in this folder and say:
```
Update events from changes-report.json
```
Claude reads the report and edits the events file directly.

**Step 3 — Push to GitHub**
```bash
git add public/events-seed.json field-hashes.json
git commit -m "Weekly update YYYY-MM-DD"
git push
```
Vercel auto-deploys on push. Done.

---

## Stack

- Frontend: single `index.html` in `/public`
- Backend: two serverless API routes (`/api/events.js`, `/api/contact.js`)
- Event data: `public/events-seed.json` — manually curated, source of truth
- Deployed on [Vercel](https://vercel.com)
- Contact form email via [Resend](https://resend.com) (optional)

---

## Project structure

```
midwest-airsoft/
├── api/
│   ├── events.js          ← serves event data to the frontend
│   └── contact.js         ← contact form handler
├── public/
│   ├── index.html         ← the whole frontend
│   └── events-seed.json   ← all event data, edit this to update listings
├── scripts/
│   └── fetch-changes.mjs  ← weekly change detector
├── fields.json            ← list of all 35 tracked fields
├── field-hashes.json      ← tracks what each field page looked like last check
└── vercel.json
```

---

## Optional: contact form emails

Add these in Vercel → Project Settings → Environment Variables:

| Variable | Value |
|---|---|
| `RESEND_API_KEY` | Your Resend API key |
| `CONTACT_EMAIL` | Where to send contact form submissions |

---

Built by an airsofter, for airsofters.
