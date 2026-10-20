// Writes the field cards in public/index.html from fields.json (the one master field list).
// Usage: node scripts/build-fields.mjs   — run after editing fields.json (apply-events.mjs runs it too).
// fields.json keys: url = link shown on the card; scanUrl = page the weekly scanner checks if different;
// scan:false = scanner skips it (Facebook-only etc.); card:false = kept for events but not shown on the site;
// eventState = state its events are filed under, if not its own (Bing Field → MO, St. Louis metro).
import { readFileSync, writeFileSync } from 'node:fs';

const STATES = { IL: 'Illinois', IN: 'Indiana', MI: 'Michigan', MN: 'Minnesota', MO: 'Missouri', OH: 'Ohio', WI: 'Wisconsin' };
const TAG_CLASS = { Indoor: 'indoor', 'Urban CQB': 'indoor', Outdoor: 'outdoor', Woodland: 'outdoor' }; // anything else → milsim
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fields = JSON.parse(readFileSync('fields.json', 'utf8'));
const ids = new Set();
for (const f of fields) {
  if (ids.has(f.id)) throw new Error(`fields.json: duplicate id "${f.id}"`);
  ids.add(f.id);
  if (f.card === false) continue;
  if (!STATES[f.state]) throw new Error(`fields.json: ${f.id} has unknown state "${f.state}"`);
  if (typeof f.lat !== 'number' || typeof f.lng !== 'number') throw new Error(`fields.json: ${f.id} needs lat/lng for its map pin`);
}

const card = f => `      <div class="field-card visible" data-state="${f.state}" data-lat="${f.lat}" data-lng="${f.lng}">
        <div class="card-corner"></div>
        <div class="field-state-row"><span class="field-state">${STATES[f.state]}</span><span class="state-rule"></span></div>
        <div class="field-name">${esc(f.name)}</div>
        <div class="field-location">${esc(f.location)}</div>
        <div class="field-tags">${(f.tags || []).map(t => `<span class="tag ${TAG_CLASS[t] || 'milsim'}">${esc(t)}</span>`).join('')}</div>
        <p class="field-desc">${esc(f.description)}</p>
        <a href="${esc(f.url)}" target="_blank" class="field-link">Visit Field Website</a>
      </div>`;

const path = 'public/index.html';
const html = readFileSync(path, 'utf8');
const START = '<!-- FIELDS:START (generated from fields.json by scripts/build-fields.mjs — edit fields.json, not this) -->';
const END = '<!-- FIELDS:END -->';
const a = html.indexOf(START), b = html.indexOf(END);
if (a < 0 || b < a) throw new Error('index.html: FIELDS:START / FIELDS:END markers not found');
const shown = fields.filter(f => f.card !== false);
writeFileSync(path, html.slice(0, a + START.length) + '\n' + shown.map(card).join('\n\n') + '\n      ' + html.slice(b));
console.log(`${shown.length} field cards written to ${path}`);
