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

  // Cap at ~1800 chars so the report stays compact
  return deduped.join("\n").slice(0, 1800);
}

// ── Fetch one field ───────────────────────────────────────────────────────────
async function fetchField(field) {
  try {
    const res = await fetch(field.url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "follow",
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const html = await res.text();
    const hash = createHash("md5").update(html).digest("hex");
    return { html, hash };
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
        text:     extractEventText(result.html),
      });
    });
  }

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
