/**
 * /api/update-events.js
 *
 * Runs every Wednesday at 6 PM Central Time (23:00 UTC) via Vercel Cron.
 * For each known field it:
 *   1. Fetches the field's website
 *   2. Sends the page text to Groq AI to extract upcoming events
 *   3. Saves the merged result to Vercel KV
 *
 * Required env vars (set in Vercel dashboard):
 *   GROQ_API_KEY       — free at console.groq.com
 *   KV_REST_API_URL    — Vercel KV (already used by events.js)
 *   KV_REST_API_TOKEN  — Vercel KV
 *
 * Vercel automatically injects CRON_SECRET and sends it as
 * "Authorization: Bearer <CRON_SECRET>" on every cron trigger.
 */

import SEED_DATA from '../public/events-seed.json' with { type: 'json' };

const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile'; // free tier

// Fields with crawlable websites (Facebook-only fields are skipped)
const FIELDS = [
  { id: 'bingfield',     name: 'Bing Field',              state: 'MO', location: 'Alton, IL',         url: 'https://bingfield.com/' },
  { id: 'twincities',   name: 'Twin Cities Airsoft',      state: 'MN', location: 'Minneapolis, MN',   url: 'https://www.twincitiesairsoft.com/' },
  { id: 'kankakee',     name: 'Kankakee Airsoft Factory', state: 'IL', location: 'Kankakee, IL',      url: 'https://mirtactical.com/airsoft/kankakee-factory-airsoft-open-play-hosted-by-mir-tactical/' },
  { id: 'mirtactical',  name: 'MiR Tactical',             state: 'IL', location: 'Buffalo Grove, IL', url: 'https://mirtactical.com/events/' },
  { id: 'blastcamp',    name: 'Blastcamp',                state: 'IN', location: 'Hobart, IN',        url: 'https://blastcamp.com/airsoft/' },
  { id: 'cedar',        name: 'Cedar Airsoft Field',      state: 'WI', location: 'Wisconsin',         url: 'https://www.cedarairsoftfield.com/' },
  { id: 'hellsurvivors',name: 'Hell Survivors',           state: 'MI', location: 'Pinckney, MI',      url: 'https://www.hellsurvivors.com/' },
  { id: 'i70',          name: 'i70 Paintball & Airsoft',  state: 'OH', location: 'Huber Heights, OH', url: 'https://www.i70paintball.com/' },
  { id: 'crossfire',    name: 'Crossfire Airsoft',        state: 'MN', location: 'Clearwater, MN',    url: 'https://www.crossfire-airsoft.com/' },
  { id: 'blackops',     name: 'Black Ops Airsoft',        state: 'WI', location: 'Bristol, WI',       url: 'https://www.blackops-airsoft.com/' },
];

/** Strip HTML tags and boilerplate, keep up to 4 000 chars of readable text */
function cleanHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 4000);
}

async function fetchPage(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MidwestAirsoft-EventBot/1.0 (weekly cron)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return cleanHtml(await res.text());
  } catch {
    return null;
  }
}

async function extractEvents(field, pageText, today) {
  const prompt = `Extract upcoming airsoft events from this website text.

Field: ${field.name}
Location: ${field.location}, ${field.state}
Today: ${today}

Website content:
${pageText}

Return ONLY a valid JSON array — no markdown fences, no explanation. Schema:
[
  {
    "date": "YYYY-MM-DD",
    "name": "Event Name",
    "type": "open|big|milsim|tournament",
    "price": "$XX or free or TBD",
    "url": "https://...",
    "fieldId": "${field.id}",
    "fieldName": "${field.name}",
    "location": "${field.location}",
    "state": "${field.state}"
  }
]

Rules:
- Only include events dated AFTER ${today}
- Dates must be YYYY-MM-DD format
- type must be one of: open, big, milsim, tournament
- Event names under 70 characters
- If no events found, return []`;

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model:       GROQ_MODEL,
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens:  1024,
    }),
  });

  if (!res.ok) throw new Error(`Groq HTTP ${res.status}`);

  const json  = await res.json();
  const text  = json.choices?.[0]?.message?.content ?? '[]';
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];

  return JSON.parse(match[0]);
}

async function saveToKV(data) {
  const res = await fetch(
    `${process.env.KV_REST_API_URL}/set/midwest-airsoft-events`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ value: JSON.stringify(data) }),
    }
  );
  return res.ok;
}

export default async function handler(req, res) {
  // Vercel cron sends: Authorization: Bearer <CRON_SECRET>
  const authHeader = req.headers['authorization'] ?? '';
  const token = authHeader.replace('Bearer ', '');
  if (process.env.CRON_SECRET && token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({ error: 'GROQ_API_KEY not set in Vercel env vars' });
  }

  const today  = new Date().toISOString().split('T')[0];
  const events = [];
  const log    = [];

  for (const field of FIELDS) {
    try {
      const text = await fetchPage(field.url);
      if (!text) {
        log.push(`${field.id}: fetch failed`);
        continue;
      }

      const found = await extractEvents(field, text, today);
      events.push(...found);
      log.push(`${field.id}: ${found.length} event(s)`);
    } catch (err) {
      log.push(`${field.id}: error — ${err.message}`);
    }
  }

  // Sort chronologically
  events.sort((a, b) => a.date.localeCompare(b.date));

  const nextRun = new Date();
  nextRun.setDate(nextRun.getDate() + 7);

  const payload = {
    lastUpdated: new Date().toISOString(),
    nextUpdate:  nextRun.toISOString(),
    note:        `Auto-updated by Groq AI on ${today}`,
    fields:      SEED_DATA.fields,   // field directory stays static
    events,
  };

  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    const saved = await saveToKV(payload);
    log.push(`KV write: ${saved ? 'success' : 'FAILED'}`);
  } else {
    log.push('KV not configured — events not persisted');
  }

  console.log('[update-events]', log.join(' | '));
  return res.status(200).json({ ok: true, eventsFound: events.length, today, log });
}
