#!/usr/bin/env node
/**
 * Weekly update tool for Midwest Airsoft Hub
 * Run with: node update.mjs
 */

import { readFileSync, writeFileSync } from "fs";
import { createInterface } from "readline";
import { execSync } from "child_process";

const DATA_PATH = "./public/events-seed.json";

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

function loadData() {
  return JSON.parse(readFileSync(DATA_PATH, "utf8"));
}

function saveData(data) {
  data.lastUpdated = new Date().toISOString();
  data.nextUpdate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

function printEvents(events) {
  if (events.length === 0) {
    console.log("  (no events)\n");
    return;
  }
  events.forEach((e, i) => {
    console.log(`  [${i + 1}] ${e.date}  ${e.name}  |  ${e.fieldName}  |  ${e.price || "free"}  |  ${e.type}`);
  });
  console.log();
}

function removePastEvents(events) {
  const today = new Date().toISOString().split("T")[0];
  const before = events.length;
  const filtered = events.filter((e) => e.date >= today);
  const removed = before - filtered.length;
  if (removed > 0) console.log(`\n🗑  Auto-removed ${removed} past event(s).`);
  return filtered;
}

async function addEvent(data) {
  console.log("\n── Add New Event ───────────────────────────────");

  // Show fields list for reference
  console.log("Fields available:");
  data.fields.forEach((f, i) => console.log(`  [${i + 1}] ${f.id}  —  ${f.name} (${f.location})`));
  console.log();

  const date = await ask("Date (YYYY-MM-DD): ");
  if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) {
    console.log("Invalid date format. Skipping.");
    return;
  }

  const name = await ask("Event name: ");
  const fieldId = await ask("Field ID (from list above): ");
  const field = data.fields.find((f) => f.id === fieldId);
  if (!field) {
    console.log("Field ID not found. Skipping.");
    return;
  }

  const typeInput = await ask("Type — milsim / big / open [open]: ");
  const type = ["milsim", "big", "open"].includes(typeInput) ? typeInput : "open";

  const price = await ask("Price (e.g. $30, or leave blank): ");
  const url = await ask(`Event URL [${field.url}]: `);

  data.events.push({
    date,
    name,
    type,
    price: price || null,
    url: url || field.url,
    fieldId: field.id,
    fieldName: field.name,
    location: field.location,
    state: field.state,
  });

  data.events.sort((a, b) => a.date.localeCompare(b.date));
  console.log("✓ Event added.");
}

async function removeEvent(data) {
  console.log("\n── Remove Event ────────────────────────────────");
  printEvents(data.events);
  if (data.events.length === 0) return;

  const input = await ask("Enter event number to remove (or blank to cancel): ");
  const idx = parseInt(input) - 1;
  if (isNaN(idx) || idx < 0 || idx >= data.events.length) {
    console.log("Cancelled.");
    return;
  }
  const removed = data.events.splice(idx, 1)[0];
  console.log(`✓ Removed: ${removed.name}`);
}

async function editField(data) {
  console.log("\n── Edit Field Info ─────────────────────────────");
  data.fields.forEach((f, i) => console.log(`  [${i + 1}] ${f.name} — ${f.url}`));
  console.log();

  const input = await ask("Enter field number to edit (or blank to cancel): ");
  const idx = parseInt(input) - 1;
  if (isNaN(idx) || idx < 0 || idx >= data.fields.length) {
    console.log("Cancelled.");
    return;
  }

  const field = data.fields[idx];
  console.log(`\nEditing: ${field.name}`);

  const name = await ask(`Name [${field.name}]: `);
  const location = await ask(`Location [${field.location}]: `);
  const description = await ask(`Description [${field.description}]: `);
  const url = await ask(`URL [${field.url}]: `);

  if (name) field.name = name;
  if (location) field.location = location;
  if (description) field.description = description;
  if (url) field.url = url;

  console.log("✓ Field updated.");
}

async function main() {
  console.log("\n════════════════════════════════════════════════");
  console.log("   MIDWEST AIRSOFT HUB — Weekly Update Tool");
  console.log("════════════════════════════════════════════════\n");

  const data = loadData();

  // Auto-remove past events
  data.events = removePastEvents(data.events);

  console.log(`\nCurrent events (${data.events.length} upcoming):`);
  printEvents(data.events);

  let running = true;
  while (running) {
    console.log("What would you like to do?");
    console.log("  [1] Add event");
    console.log("  [2] Remove event");
    console.log("  [3] Edit field info / URL");
    console.log("  [4] View all events");
    console.log("  [5] Save & push to website");
    console.log("  [6] Exit without saving\n");

    const choice = await ask("Choice: ");

    switch (choice.trim()) {
      case "1":
        await addEvent(data);
        break;
      case "2":
        await removeEvent(data);
        break;
      case "3":
        await editField(data);
        break;
      case "4":
        console.log("\nAll upcoming events:");
        printEvents(data.events);
        break;
      case "5": {
        saveData(data);
        console.log("\n✓ Saved events-seed.json");
        try {
          execSync("git add public/events-seed.json", { stdio: "inherit" });
          const today = new Date().toISOString().split("T")[0];
          execSync(`git commit -m "Weekly update ${today}"`, { stdio: "inherit" });
          execSync("git push", { stdio: "inherit" });
          console.log("\n✓ Pushed to GitHub — Vercel is deploying now.\n");
        } catch (err) {
          console.error("Git error:", err.message);
        }
        running = false;
        break;
      }
      case "6":
        console.log("Exited without saving.\n");
        running = false;
        break;
      default:
        console.log("Invalid choice.\n");
    }
  }

  rl.close();
}

main();
