#!/usr/bin/env node
/**
 * Quick event adder for Midwest Airsoft Hub
 *
 * Usage:
 *   node add-event.mjs "2026-05-10" "Big Spring Game" bingfield milsim "$30"
 *   node add-event.mjs "2026-05-10" "Open Play" blastcamp open
 *   node add-event.mjs --list-fields
 *   node add-event.mjs --push
 *
 * Args: <date> <name> <fieldId> <type> [price]
 *   date    — YYYY-MM-DD
 *   name    — event name (quote it)
 *   fieldId — from --list-fields
 *   type    — milsim | big | open
 *   price   — optional, e.g. "$30" or "TBD"
 */

import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";

const DATA = "./public/events-seed.json";
const args = process.argv.slice(2);

// ── List fields ──────────────────────────────────────────────────────────────
if (args[0] === "--list-fields") {
  const data = JSON.parse(readFileSync(DATA, "utf8"));
  console.log("\nAvailable fields:\n");
  data.fields.forEach((f) =>
    console.log(`  ${f.id.padEnd(20)} ${f.name.padEnd(35)} ${f.location}`)
  );
  console.log();
  process.exit(0);
}

// ── Push ─────────────────────────────────────────────────────────────────────
if (args[0] === "--push") {
  const today = new Date().toISOString().split("T")[0];
  try {
    execSync("git add public/events-seed.json", { stdio: "inherit" });
    execSync(`git commit -m "Add events ${today}"`, { stdio: "inherit" });
    execSync("git push", { stdio: "inherit" });
    console.log("\nPushed — Vercel deploying now.\n");
  } catch (e) {
    console.error("Git error:", e.message);
  }
  process.exit(0);
}

// ── Add event ────────────────────────────────────────────────────────────────
const [date, name, fieldId, type, price] = args;

if (!date || !name || !fieldId || !type) {
  console.log(`
Usage:  node add-event.mjs <date> <name> <fieldId> <type> [price]

  node add-event.mjs "2026-05-10" "Big Game" bingfield milsim "\$30"
  node add-event.mjs --list-fields    Show field IDs
  node add-event.mjs --push           Commit & push to site
`);
  process.exit(1);
}

if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error("Bad date format. Use YYYY-MM-DD.");
  process.exit(1);
}

if (!["milsim", "big", "open"].includes(type)) {
  console.error("Type must be: milsim | big | open");
  process.exit(1);
}

const data = JSON.parse(readFileSync(DATA, "utf8"));
const field = data.fields.find((f) => f.id === fieldId);

if (!field) {
  console.error(`Field "${fieldId}" not found. Run: node add-event.mjs --list-fields`);
  process.exit(1);
}

const badge =
  type === "milsim" ? "MilSim" : type === "big" ? "Big Game" : "Open Play";

const event = {
  date,
  name,
  type,
  price: price || "TBD",
  url: field.url,
  venue: `${field.name} · ${field.location}`,
  state: field.state,
  badge,
  base: true,
};

data.events.push(event);
data.events.sort((a, b) => {
  if (a.date === "recurring") return -1;
  if (b.date === "recurring") return 1;
  return a.date.localeCompare(b.date);
});

writeFileSync(DATA, JSON.stringify(data, null, 2));
console.log(`\nAdded: ${date}  ${name}  (${field.name}, ${type}, ${price || "TBD"})`);
console.log(`\nRun "node add-event.mjs --push" when ready to deploy.\n`);
