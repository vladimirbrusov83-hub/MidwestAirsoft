#!/usr/bin/env node
/**
 * Midwest Airsoft — Change Detector
 *
 * Fetches all field pages, detects which ones changed since last run,
 * and extracts only event-relevant text for changed fields.
 *
 * Output: changes-report.json  (compact, Claude-readable)
 * State:  field-hashes.json    (persists across runs)
 *
 * Usage: node scripts/fetch-changes.mjs
 * Then:  tell Claude Code "update events from changes-report.json"
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { createHash } from "crypto";

const FIELDS      = JSON.parse(readFileSync("./fields.json", "utf8"));
const HASHES_PATH = "./field-hashes.json";
const REPORT_PATH = "./changes-report.json";
const CONCURRENCY = 5;
const TIMEOUT_MS  = 12000;

// ── Load stored hashes ────────────────────────────────────────────────────────
const storedHashes = existsSync(HASHES_PATH)
  ? JSON.parse(readFileSync(HASHES_PATH, "utf8"))
  : {};

// ── HTML → compact event text ─────────────────────────────────────────────────
function extractEventText(html) {
  // Drop entire blocks that never contain event data
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  // Preserve datetime attributes before stripping tags
  text = text.replace(/<time[^>]*datetime="([^"]*)"[^>]*>/gi, " $1 ");

  // Strip all remaining tags
  text = text.replace(/<[^>]+>/g, " ");

  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#8211;/g, "–")
    .replace(/&#8212;/g, "—")
    .replace(/&#\d+;/g, " ")
    .replace(/&[a-z]+;/g, " ");

  // Collapse whitespace
  text = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  // Split into candidate lines
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 3);

  // Patterns that indicate an event-relevant line
  const DATE_RE = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b.{0,30}\d{1,2}|\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\b20\d{2}[-\/]\d{2}[-\/]\d{2}|\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
  const EVENT_RE = /\b(event|game|play|milsim|open play|big game|scenario|operation|op |walk[-\s]?on|skirmish|register|sign[\s-]?up|tickets?|price|\$\d{1,3})\b/i;

  const relevant = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (DATE_RE.test(line) || EVENT_RE.test(line)) {
      // Include 1 line of context before and after for readability
      if (i > 0 && !relevant.includes(lines[i - 1])) relevant.push(lines[i - 1]);
      relevant.push(line);
      if (i < lines.length - 1) relevant.push(lines[i + 1]);
    }
  }

  // Deduplicate while preserving order
  const seen = new Set();
  const deduped = relevant.filter((l) => {
    if (seen.has(l)) return false;
    seen.add(l);
    return true;
  });

  // Cap so the report stays compact (1800 cut off later events on long schedule pages)
  return deduped.join("\n").slice(0, 5000);
}

// ── RSS XML → compact event text ─────────────────────────────────────────────
function extractRssText(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRe.exec(xml)) !== null) {
    const block = match[1];
    const title   = (block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) || block.match(/<title>([\s\S]*?)<\/title>/))?.[1]?.trim() || "";
    const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/))?.[1]?.trim() || "";
    const link    = (block.match(/<link>([\s\S]*?)<\/link>/)     || block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/))?.[1]?.trim() || "";
    // Event date lives in the post body (e.g. "Date: Friday October 16th, 2026"), not the title
    const body    = (block.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/) || block.match(/<description>([\s\S]*?)<\/description>/))?.[1] || "";
    const bodyTxt = body.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#\d+;|&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
    const dateBit = (bodyTxt.match(/\bDates?\s*:[^]{0,80}/i)?.[0] || bodyTxt.slice(0, 120)).trim();
    // pubDate as ISO so the extractor doesn't mistake "Oct 2026" for an event date
    const posted  = pubDate && !isNaN(Date.parse(pubDate)) ? new Date(pubDate).toISOString().slice(0, 10) : "";
    const name    = title.replace(/&#8211;|&#8212;/g, "–").replace(/&#8217;|&#039;/g, "'").replace(/&amp;/g, "&");
    if (title) items.push(`${name}${dateBit ? " ¦ " + dateBit : ""}${posted ? " ¦ posted " + posted : ""}${link ? " | " + link : ""}`);
  }
  return items.join("\n").slice(0, 1800);
}

// ── Fetch one field ───────────────────────────────────────────────────────────
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
// Some bot shields (e.g. bingfield.com) 403 a fake browser UA but allow an honest bot one
const BOT_UA     = "MidwestAirsoftBot/1.0 (+https://www.midwestairsoft.space)";

// Fields marked "render": true build their page with JavaScript (Square, Gator,
// some Wix widgets), so plain fetch sees no events. Load those in headless Chromium.
// Playwright is installed only in the GitHub workflow, not in package.json.
let browser;
async function renderField(field) {
  try {
    if (!browser) {
      const { chromium } = await import("playwright");
      browser = await chromium.launch();
    }
    const page = await browser.newPage({ userAgent: BROWSER_UA });
    try {
      await page.goto(field.url, { timeout: 30000, waitUntil: "domcontentloaded" });
      await page.waitForTimeout(4000);
      const text = await page.evaluate(() => document.body.innerText);
      if (text.trim().length < 50) return { error: "render: page came back empty" };
      return { html: text, hash: createHash("md5").update(text).digest("hex"), isRss: false };
    } finally {
      await page.close();
    }
  } catch (err) {
    return { error: `render: ${err.message.split("\n")[0]}` };
  }
}

async function fetchField(field) {
  if (field.render) return renderField(field);
  const fetchUrl = field.rssUrl || field.url;
  const isRss    = !!field.rssUrl;
  const get = (ua) => fetch(fetchUrl, {
    headers: {
      "User-Agent": ua,
      Accept: isRss ? "application/rss+xml,application/xml,text/xml" : "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "follow",
  });
  try {
    // Try each UA until one gets a real page; a feed must contain <item>s, otherwise
    // it's a block/challenge page — report it and don't store its hash
    const tried = [];
    let body = null;
    for (const ua of [BROWSER_UA, BOT_UA, "curl/8.7.1"]) {
      const res = await get(ua);
      const text = await res.text();
      if (res.ok && (!isRss || /<item>/i.test(text))) { body = text; break; }
      tried.push(`${res.status} "${(text.match(/<title>([^<]{0,40})/i) || [])[1] || ""}"`);
      if (!isRss && res.status !== 403) break;
    }
    if (body === null) return { error: `blocked or empty: ${tried.join(" / ")}` };
    const hash = createHash("md5").update(body).digest("hex");
    return { html: body, hash, isRss };
  } catch (err) {
    return { error: err.message.split("\n")[0] };
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const isFirstRun = Object.keys(storedHashes).length === 0;

  console.log("\n══════════════════════════════════════════════════");
  console.log("   MIDWEST AIRSOFT — Change Detector");
  console.log("══════════════════════════════════════════════════");
  if (isFirstRun) {
    console.log("  First run: building baseline hashes for all fields.");
    console.log("  All fields will appear as changed this time only.\n");
  } else {
    console.log(`\n  Checking ${FIELDS.length} fields for changes...\n`);
  }

  const newHashes = { ...storedHashes };
  const changed   = [];
  const unchanged = [];
  const errors    = [];

  // Process in batches to avoid hammering servers
  for (let i = 0; i < FIELDS.length; i += CONCURRENCY) {
    const batch   = FIELDS.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((f) => fetchField(f)));

    results.forEach((result, j) => {
      const field = batch[j];
      const label = `  [${String(i + j + 1).padStart(2)}] ${field.name.padEnd(35)}`;

      if (result.error) {
        console.log(`${label} ERROR — ${result.error}`);
        errors.push({ id: field.id, name: field.name, error: result.error });
        return;
      }

      if (!isFirstRun && result.hash === storedHashes[field.id]) {
        console.log(`${label} ·  no change`);
        unchanged.push(field.id);
        return;
      }

      console.log(`${label} ✦  CHANGED`);
      newHashes[field.id] = result.hash;
      changed.push({
        id:       field.id,
        name:     field.name,
        state:    field.state,
        location: field.location,
        url:      field.url,
        text:     result.isRss ? extractRssText(result.html) : extractEventText(result.html),
      });
    });
  }

  if (browser) await browser.close();

  // Persist updated hashes
  writeFileSync(HASHES_PATH, JSON.stringify(newHashes, null, 2));

  // Write compact report
  const report = {
    checkedAt: new Date().toISOString().split("T")[0],
    summary: `${changed.length} changed, ${unchanged.length} unchanged, ${errors.length} errors`,
    changed,
    ...(errors.length > 0 && { errors }),
  };
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  // Summary
  console.log("\n──────────────────────────────────────────────────");
  console.log(`  ${changed.length.toString().padStart(2)} fields changed`);
  console.log(`  ${unchanged.length.toString().padStart(2)} fields unchanged`);
  if (errors.length > 0) console.log(`  ${errors.length.toString().padStart(2)} errors (check URLs in fields.json)`);
  console.log("\n  Saved: changes-report.json");
  console.log("  Saved: field-hashes.json\n");

  if (changed.length > 0) {
    console.log("  Next step — open Claude Code and say:");
    console.log('  "Update events from changes-report.json"\n');
  } else {
    console.log("  Nothing changed — no update needed.\n");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
