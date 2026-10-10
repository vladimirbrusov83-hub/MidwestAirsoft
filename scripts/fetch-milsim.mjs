#!/usr/bin/env node
/**
 * MilSim tab — pulls upcoming events from the 3 national organizers
 * (MilSim West, RealSim, American Milsim) into public/milsim.json.
 *
 * - One parser per site; dates on these sites mostly have no year, so a date
 *   that already passed rolls to next year only if it's within ~4 months
 *   (Dec→Jan), otherwise it's last season's leftover and dropped.
 * - If a site fails or returns 0 events, that organizer's previous entries are kept.
 * - Locations are geocoded once (Nominatim) and cached in milsim.json.
 *
 * Usage: node scripts/fetch-milsim.mjs
 */
import { readFileSync, writeFileSync, existsSync } from "fs";

const OUT = "./public/milsim.json";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const today = new Date().toISOString().slice(0, 10);
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { events: [], geo: {} };
const geo = { ...(prev.geo || {}) };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const mon = (s) => MONTHS.indexOf(s.slice(0, 3).toLowerCase()) + 1;
const pad = (n) => String(n).padStart(2, "0");
const soon = new Date(Date.now() + 120 * 864e5).toISOString().slice(0, 10);

// "Oct 30-Nov 1", "November 13-15", "December 12-13" → {start, end}, with year inference
function parseRange(txt, year) {
  const m = txt.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})\s*[-–]\s*(?:([A-Za-z]{3,9})\.?\s+)?(\d{1,2})\b/);
  if (!m || mon(m[1]) < 1) return null;
  const m1 = mon(m[1]), d1 = +m[2], m2 = m[3] ? mon(m[3]) : m1, d2 = +m[4];
  let y = year || +today.slice(0, 4);
  let start = `${y}-${pad(m1)}-${pad(d1)}`;
  if (!year && start < today) {
    start = `${y + 1}-${pad(m1)}-${pad(d1)}`;
    if (start > soon) return null; // last season's leftover
    y += 1;
  }
  const end = `${m2 < m1 ? y + 1 : y}-${pad(m2)}-${pad(d2)}`;
  return { start, end };
}

const text = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<\/(p|h\d|li|div)>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&").replace(/&#8211;|&ndash;/g, "–").replace(/&#8217;|&rsquo;/g, "'").replace(/&nbsp;|&#\d+;|&[a-z]+;/g, " ")
  .split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);

async function get(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.text();
}

// ── MilSim West: each event = heading(s) + ticketspice link + poster ──────────
async function msw() {
  const h = await get("https://www.milsimwest.com/tickets");
  const out = [];
  const re = /href="(https:\/\/milsimwest\.ticketspice\.com\/[^"]+)"/g;
  let m, last = 0;
  while ((m = re.exec(h))) {
    const chunk = h.slice(last, h.lastIndexOf("<a", m.index)); // text since previous event, up to this link tag
    // last two text lines before the link: "Name [date]" + "[date at venue in] City, ST"
    const lines = text(chunk).filter((l) => !/[="<>]/.test(l) && !/purchase|important|tacsop|non-refundable|fill out/i.test(l));
    const [a, b] = lines.slice(-2);
    if (!a || !b) { last = m.index + 1; continue; }
    const date = parseRange(`${a} ${b}`);
    const loc = b.match(/(?:\bin\s+|^)([A-Za-z .]+),\s*([A-Z]{2})\s*$/);
    const name = a.replace(/\s*[-–]?\s*\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d.*$/i, "").trim();
    const after = h.slice(m.index, m.index + 4000);
    const img = (after.match(/(?:data-src|src)="(https:\/\/images\.squarespace-cdn\.com\/[^"?]+)/) || [])[1];
    last = m.index + 1;
    if (!date || !loc || !name) continue;
    out.push({ org: "msw", name, ...date, city: loc[1].trim(), state: loc[2], url: m[1], image: img });
  }
  return out;
}

// ── RealSim: "<Name> - Tickets Live" + "Fri, Mar 26, 2027 … - Sun, Mar 28, 2027" + address ──
async function realsim() {
  const h = await get("https://www.realsimevents.com/events");
  const L = text(h);
  const out = [];
  L.forEach((l, i) => {
    const d = l.match(/^\w{3}, (\w{3}) (\d{1,2}), (\d{4}).*?[-–] \w{3}, (\w{3}) (\d{1,2}), (\d{4})/);
    if (!d) return;
    const start = `${d[3]}-${pad(mon(d[1]))}-${pad(+d[2])}`, end = `${d[6]}-${pad(mon(d[4]))}-${pad(+d[5])}`;
    const name = (L.slice(Math.max(0, i - 3), i).reverse().find((x) => /operation|op\b/i.test(x)) || "")
      .replace(/\s*[-–]\s*tickets.*$/i, "").replace(/\b\w+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
    const addr = L.slice(i + 1, i + 4).find((x) => /,\s*[A-Z]{2}\s+\d{5}/.test(x)) || "";
    const loc = addr.match(/([A-Za-z .]+),\s*([A-Z]{2})\s+\d{5}/);
    if (!name || !loc) return;
    const venue = L[i + 1] && !/\d{5}/.test(L[i + 1]) ? L[i + 1] : "";
    out.push({ org: "realsim", name, start, end, city: loc[1].trim(), state: loc[2], venue, url: "https://www.realsimevents.com/events" });
  });
  const img = (h.match(/(?:data-src|src)="(https:\/\/images\.squarespace-cdn\.com\/[^"?]*banner[^"?]*)/i) || [])[1];
  out.forEach((e) => (e.image = img));
  return out;
}

// ── American Milsim: grid items with status live/closed, "Month D-D / City, ST*" ──
async function ams() {
  const h = await get("https://americanmilsim.com/events/");
  const out = [];
  for (const item of h.split(/<div class="nectar-post-grid-item(?=[ "])/).slice(1)) {
    if (/^[^>]*closed/.test(item) || /status closed/.test(item)) continue;
    const name = (item.match(/class="post-heading"><span>([^<]+)/) || [])[1];
    const when = (item.match(/<strong><span>([^<]+)<\/span><\/strong>/) || [])[1];
    const url = (item.match(/class="nectar-post-grid-link" href="([^"]+)"/) || [])[1];
    const image = (item.match(/data-nectar-img-src="([^"]+)"/) || [])[1];
    if (!name || !when) continue;
    const date = parseRange(when);
    const loc = when.match(/\/\s*([A-Za-z .]+),\s*([A-Z]{2})/);
    if (!date || !loc) continue;
    out.push({ org: "ams", name: name.replace(/&#8217;/g, "'").replace(/&amp;/g, "&").trim(), ...date, city: loc[1].trim(), state: loc[2], url, image });
  }
  return out;
}

// spellings Nominatim can't resolve (site typos)
const GEO_FIX = { "Erhardt, SC": { lat: 33.0957, lng: -81.0151 } };

async function geocode(city, state) {
  const key = `${city}, ${state}`;
  if (GEO_FIX[key]) return GEO_FIX[key];
  if (geo[key]) return geo[key];
  const q = new URLSearchParams({ city, state, country: "USA", format: "json", limit: "1" });
  const r = await fetch(`https://nominatim.openstreetmap.org/search?${q}`, {
    headers: { "User-Agent": "MidwestAirsoftBot/1.0 (+https://www.midwestairsoft.space)" },
    signal: AbortSignal.timeout(15000),
  });
  const j = r.ok ? await r.json() : [];
  await new Promise((res) => setTimeout(res, 1100)); // Nominatim: max 1 req/s
  if (!j[0]) return null;
  return (geo[key] = { lat: +(+j[0].lat).toFixed(4), lng: +(+j[0].lon).toFixed(4) });
}

const ORGS = { msw, realsim, ams };
const events = [];
for (const [org, fn] of Object.entries(ORGS)) {
  let got = [];
  try { got = await fn(); } catch (e) { console.log(`  ${org}: ERROR ${e.message}`); }
  got = got.filter((e) => e.end >= today);
  if (!got.length) {
    got = (prev.events || []).filter((e) => e.org === org && e.end >= today);
    console.log(`  ${org}: nothing parsed — keeping ${got.length} previous`);
  } else console.log(`  ${org}: ${got.length} upcoming`);
  // "ERHARDT" → "Erhardt"
  got.forEach((e) => { if (e.city === e.city.toUpperCase()) e.city = e.city.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()); });
  events.push(...got);
}
for (const e of events) {
  if (e.lat != null) continue;
  const g = await geocode(e.city, e.state);
  if (g) Object.assign(e, g); else console.log(`  no location for ${e.city}, ${e.state}`);
}
events.sort((a, b) => a.start.localeCompare(b.start));
writeFileSync(OUT, JSON.stringify({ lastUpdated: new Date().toISOString(), events, geo }, null, 2) + "\n");
events.forEach((e) => console.log(`  ${e.start}–${e.end.slice(5)}  ${e.org.padEnd(7)} ${e.name} · ${e.city}, ${e.state}`));
