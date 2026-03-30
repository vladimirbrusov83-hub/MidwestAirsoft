/**
 * /api/update-events.js
 *
 * Cron: every Wednesday 6 PM CT (23:00 UTC) — vercel.json schedule.
 *
 * Flow:
 *   1. Fetch each field's website
 *   2. Ask Groq AI to extract upcoming events from the page text
 *   3. Commit the result as public/events-seed.json to GitHub
 *   4. Vercel auto-deploys → frontend gets fresh data
 *
 * Required env vars (Vercel dashboard):
 *   GROQ_API_KEY    — console.groq.com (free)
 *   GITHUB_TOKEN    — github.com/settings/personal-access-tokens
 *                     (fine-grained, Contents: read+write, MidwestAirsoft repo only)
 */

import SEED_DATA from '../public/events-seed.json' with { type: 'json' };

const GROQ_URL    = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL  = 'llama-3.3-70b-versatile';
const GITHUB_REPO = 'vladimirbrusov83-hub/MidwestAirsoft';
const SEED_PATH   = 'public/events-seed.json';

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
  { id: 'wardenoh',     name: 'War Den Airsoft',          state: 'OH', location: 'Stone Creek, OH',   url: 'https://www.theairsoftden.com/' },
  { id: 'blackops',     name: 'Black Ops Airsoft',        state: 'WI', location: 'Bristol, WI',       url: 'https://www.blackops-airsoft.com/' },
];

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
      headers: { 'User-Agent': 'MidwestAirsoft-EventBot/1.0' },
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

Field: ${field.name}, ${field.location}, ${field.state}
Today: ${today}

Website content:
${pageText}

Return ONLY a valid JSON array — no markdown, no explanation:
[{"date":"YYYY-MM-DD","name":"Event Name","type":"open|big|milsim|tournament","price":"$XX or TBD","url":"https://...","fieldId":"${field.id}","fieldName":"${field.name}","location":"${field.location}","state":"${field.state}"}]

Rules: only events after ${today}, YYYY-MM-DD dates, names under 70 chars, return [] if none found.`;

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: GROQ_MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 1024 }),
  });

  if (!res.ok) throw new Error(`Groq HTTP ${res.status}`);
  const json  = await res.json();
  const text  = json.choices?.[0]?.message?.content ?? '[]';
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try { return JSON.parse(match[0]); } catch { return []; }
}

async function commitToGitHub(content) {
  const token = process.env.GITHUB_TOKEN;
  const apiBase = `https://api.github.com/repos/${GITHUB_REPO}/contents/${SEED_PATH}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' };

  // Need the current file's SHA to update it
  const getRes = await fetch(apiBase, { headers });
  const { sha } = await getRes.json();

  const putRes = await fetch(apiBase, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message: `chore: auto-update events ${new Date().toISOString().split('T')[0]}`,
      content: Buffer.from(content).toString('base64'),
      sha,
    }),
  });

  return putRes.ok;
}

export default async function handler(req, res) {
  // Vercel cron sends: Authorization: Bearer <CRON_SECRET>
  const token = (req.headers['authorization'] ?? '').replace('Bearer ', '');
  if (process.env.CRON_SECRET && token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!process.env.GROQ_API_KEY)   return res.status(500).json({ error: 'GROQ_API_KEY not set' });
  if (!process.env.GITHUB_TOKEN)   return res.status(500).json({ error: 'GITHUB_TOKEN not set' });

  const today  = new Date().toISOString().split('T')[0];
  const events = [];
  const log    = [];

  for (let i = 0; i < FIELDS.length; i++) {
    const field = FIELDS[i];
    try {
      const text = await fetchPage(field.url);
      if (!text) { log.push(`${field.id}: fetch failed`); continue; }

      const found = await extractEvents(field, text, today);
      events.push(...found);
      log.push(`${field.id}: ${found.length} event(s)`);
    } catch (err) {
      log.push(`${field.id}: error — ${err.message}`);
    }
    // 6-second pause between requests to stay under Groq free tier 12k TPM limit
    if (i < FIELDS.length - 1) await new Promise(r => setTimeout(r, 6000));
  }

  events.sort((a, b) => a.date.localeCompare(b.date));

  // Merge: keep all base (manually curated) events, add/replace auto-extracted ones
  const baseEvents = (SEED_DATA.events || []).filter(ev => ev.base === true);
  const autoKeys   = new Set(events.map(ev => `${ev.date}|${ev.name}`));
  const mergedBase = baseEvents.filter(ev => {
    if (ev.date === 'recurring') return true; // always keep recurring events
    return !autoKeys.has(`${ev.date}|${ev.name}`);
  });
  const allEvents = [...mergedBase, ...events];
  allEvents.sort((a, b) => {
    const aKey = a.date === 'recurring' ? '0000' : a.date;
    const bKey = b.date === 'recurring' ? '0000' : b.date;
    return aKey.localeCompare(bKey);
  });

  const nextRun = new Date();
  nextRun.setDate(nextRun.getDate() + 7);

  const payload = {
    lastUpdated: new Date().toISOString(),
    nextUpdate:  nextRun.toISOString(),
    note:        `Auto-updated by Groq AI on ${today}. Base events preserved.`,
    fields:      SEED_DATA.fields,
    events:      allEvents,
  };

  const committed = await commitToGitHub(JSON.stringify(payload, null, 2));
  log.push(`GitHub commit: ${committed ? 'success → Vercel deploying' : 'FAILED'}`);

  console.log('[update-events]', log.join(' | '));
  return res.status(200).json({ ok: true, eventsFound: events.length, today, log });
}
