// Prints a compact list of candidate upcoming-event lines per field, for the weekly update.
// Merges every changes-report.json committed since events-seed.json's lastUpdated (latest text wins),
// keeps only lines containing a future date, and drops dates that already have an event for that field.
// Usage: node scripts/extract-events.mjs
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const seed = JSON.parse(readFileSync('public/events-seed.json', 'utf8'));
const today = new Date().toISOString().slice(0, 10);
const since = seed.lastUpdated || '2000-01-01';

// Collect field texts from all report versions since last update (oldest → newest).
const shas = execSync(`git log --reverse --since="${since}" --format=%H -- changes-report.json`, { encoding: 'utf8' })
  .trim().split('\n').filter(Boolean);
const fields = {};
for (const sha of shas.length ? shas : ['HEAD']) {
  let r;
  try { r = JSON.parse(execSync(`git show ${sha}:changes-report.json`, { encoding: 'utf8', maxBuffer: 1 << 26 })); } catch { continue; }
  for (const f of r.changed || []) fields[f.id] = f;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const monRe = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*[-–&]\s*\d{1,2}(?:st|nd|rd|th)?)?(?:,?\s*(20\d\d))?/gi;
const numRe = /\b(\d{1,2})\/(\d{1,2})(?:\/(20\d\d|\d\d))?\b/g;
const pad = n => String(n).padStart(2, '0');

// Returns [{iso, idx}] for each date in the line. Yearless past dates roll to next year only if within ~4 months
// (Dec→Jan rollover); otherwise they're last season's schedule and dropped.
const soon = new Date(Date.now() + 120 * 864e5).toISOString().slice(0, 10);
function datesIn(line) {
  const out = [];
  const year = +today.slice(0, 4);
  const push = (m, d, y, idx) => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return;
    const yr = y ? (y < 100 ? 2000 + y : y) : year;
    let iso = `${yr}-${pad(m)}-${pad(d)}`;
    if (!y && iso < today) { iso = `${yr + 1}-${pad(m)}-${pad(d)}`; if (iso > soon) return; }
    out.push({ iso, idx });
  };
  for (const m of line.matchAll(monRe)) push(MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, +m[2], m[3] && +m[3], m.index);
  for (const m of line.matchAll(numRe)) push(+m[1], +m[2], m[3] && +m[3], m.index);
  return out;
}

const horizon = new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10);
let total = 0;
for (const f of Object.values(fields)) {
  // older events lack fieldId — match those by venue name too
  const have = new Set(seed.events.filter(e => e.fieldId === f.id || (e.venue || '').startsWith(f.name)).map(e => e.date));
  const seen = new Set();
  const lines = [];
  const rows = (f.text || '').split('\n').map(r => r.replace(/\s+/g, ' ').trim()).filter(r => r.length >= 3);
  rows.forEach((line, i) => {
    let prevIso = '';
    for (const { iso, idx } of datesIn(line)) {
      // skip 2nd day of a multi-day range (e.g. "Nov 7 - Nov 8")
      const close = prevIso && (new Date(iso) - new Date(prevIso)) / 864e5 <= 2;
      prevIso = iso;
      if (close || iso < today || iso > horizon || have.has(iso)) continue;
      // short lines (bare dates) get the neighbouring lines as context for the event name
      const ctx = line.length < 45 ? [rows[i - 1], line, rows[i + 1]].filter(Boolean).join(' ¦ ') : line;
      const snip = ctx.length <= 160 ? ctx : ctx.slice(Math.max(0, idx - 50), idx + 110);
      if (seen.has(iso + snip)) continue;
      seen.add(iso + snip);
      lines.push(`  ${iso} | ${snip}`);
    }
  });
  if (!lines.length) continue;
  total += lines.length;
  console.log(`## ${f.id} (${f.name}, ${f.location}) ${f.url}`);
  // recurring entries already cover regular open plays — skip candidates they include
  const rec = seed.events.filter(e => e.date === 'recurring' && (e.fieldId === f.id || (e.venue || '').startsWith(f.name)));
  if (rec.length) console.log(`  (already listed as recurring: ${rec.map(e => e.name).join('; ')})`);
  console.log(lines.slice(0, 15).join('\n') + (lines.length > 15 ? `\n  …+${lines.length - 15} more` : ''));
}
const past = seed.events.filter(e => e.date !== 'recurring' && e.date < today).length;
console.log(`\n# reports merged: ${shas.length} | candidate lines: ${total} | past events to prune: ${past}`);
