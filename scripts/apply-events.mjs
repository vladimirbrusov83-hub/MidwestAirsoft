// Prunes past events, merges new ones, stamps lastUpdated/nextUpdate, writes events-seed.json.
// Usage: node scripts/apply-events.mjs [new-events.json]
// new-events.json: array of minimal events, e.g.
//   [{"fieldId":"bingfield","date":"2026-10-11","name":"Night Game","type":"open","price":"$25","url":"https://..."}]
// venue/state/fieldName/location are filled from the field record when omitted.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const path = 'public/events-seed.json';
const seed = JSON.parse(readFileSync(path, 'utf8'));
const today = (d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'))(new Date()); // local date, not UTC
const before = seed.events.length;
const allFields = JSON.parse(readFileSync('fields.json', 'utf8')); // the one master field list

seed.events = seed.events.filter(e => e.date === 'recurring' || e.date >= today);
const pruned = before - seed.events.length;

let added = 0, skipped = [];
const file = process.argv[2];
if (file && existsSync(file)) {
  for (const n of JSON.parse(readFileSync(file, 'utf8'))) {
    const f = allFields.find(x => x.id === n.fieldId);
    if (!f) { skipped.push(`${n.fieldId}: unknown field`); continue; }
    if (seed.events.some(e => e.date === n.date && (e.fieldId === n.fieldId || (e.venue || '').startsWith(f.name)))) { skipped.push(`${n.fieldId} ${n.date}: duplicate`); continue; }
    const rec = seed.events.find(e => e.date === 'recurring' && (e.fieldId === f.id || (e.venue || '').startsWith(f.name)));
    if (rec && (n.type || 'open') === 'open') { skipped.push(`${n.fieldId} ${n.date}: covered by recurring "${rec.name}"`); continue; }
    const loc = f.location;
    // Field has rental gear → beginner friendly, unless the event says beginner:false (Tier 1 / outside-hosted ops)
    const beginner = n.beginner ?? !!f.rentals;
    seed.events.push({
      date: n.date, name: n.name, type: n.type || 'open', price: n.price || 'TBD',
      url: n.url || f.scanUrl || f.url, venue: n.venue || `${f.name} · ${loc}`, state: f.state,
      ...(n.badge && { badge: n.badge }),
      fieldId: f.id, fieldName: f.name, location: loc,
      ...(beginner && { beginner: true }),
    });
    added++;
  }
}

seed.events.sort((a, b) => (a.date === 'recurring') - (b.date === 'recurring') || a.date.localeCompare(b.date));
const now = new Date();
seed.lastUpdated = now.toISOString();
seed.nextUpdate = new Date(now.getTime() + 7 * 864e5).toISOString();
writeFileSync(path, JSON.stringify(seed, null, 2) + '\n');

// keep the field cards in index.html in step with fields.json
execSync('node scripts/build-fields.mjs', { stdio: 'inherit' });

const upcoming = seed.events.filter(e => e.date !== 'recurring').length;
console.log(`pruned ${pruned} past · added ${added} · total ${seed.events.length} (${upcoming} dated, ${seed.events.length - upcoming} recurring)`);
if (skipped.length) console.log('skipped: ' + skipped.join('; '));
