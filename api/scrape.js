/**
 * /api/scrape.js
 *
 * Vercel Serverless Function — runs weekly via cron (Monday 6am UTC)
 * Can also be triggered manually: GET /api/scrape?secret=YOUR_SECRET
 *
 * Flow:
 *   1. Fetch raw HTML from each field website
 *   2. Send relevant text to Claude API for structured event extraction
 *   3. Merge with static fields data
 *   4. Write events.json to /public/ so the frontend can load it
 *
 * Env vars needed in Vercel dashboard:
 *   ANTHROPIC_API_KEY   — your Anthropic key
 *   CRON_SECRET         — any random string to protect manual trigger
 */

import { writeFile } from "fs/promises";
import { join } from "path";

// ─── FIELD SOURCES ────────────────────────────────────────────────────────────
// Each entry defines where to scrape and how to identify the content.
const SOURCES = [
  {
    id: "bingfield",
    name: "Bing Field Airsoft & Paintball Park",
    location: "Alton, IL (St. Louis Metro)",
    state: "MO",
    url: "https://bingfield.com/index.php/category/events/",
    siteUrl: "https://bingfield.com/",
    tags: ["Outdoor", "Big Games"],
  },
  {
    id: "twincities",
    name: "Twin Cities Airsoft (TCA)",
    location: "Minneapolis/St. Paul Metro, MN",
    state: "MN",
    url: "https://www.twincitiesairsoft.com/specials/special-events.html",
    siteUrl: "https://www.twincitiesairsoft.com/",
    tags: ["Outdoor", "Scenario Games", "MilSim"],
  },
  {
    id: "kankakee",
    name: "Kankakee Airsoft Factory (MiR Tactical)",
    location: "Kankakee, IL",
    state: "IL",
    url: "https://mirtactical.com/airsoft/kankakee-factory-airsoft-open-play-hosted-by-mir-tactical/",
    siteUrl: "https://mirtactical.com/",
    tags: ["Indoor", "Outdoor", "MilSim"],
  },
  {
    id: "mirtactical_events",
    name: "MiR Tactical Events",
    location: "Illinois Region",
    state: "IL",
    url: "https://mirtactical.com/events_strikeball_airsoft_milsim/",
    siteUrl: "https://mirtactical.com/",
    tags: ["MilSim", "Tier 1"],
  },
  {
    id: "blastcamp",
    name: "Blastcamp Paintball & Airsoft",
    location: "Hobart, IN",
    state: "IN",
    url: "https://blastcamp.com/events/",
    siteUrl: "https://blastcamp.com/",
    tags: ["Outdoor", "MilSim"],
  },
  {
    id: "cedar",
    name: "Cedar Airsoft Field",
    location: "Wisconsin",
    state: "WI",
    url: "https://www.cedarairsoftfield.com/events",
    siteUrl: "https://www.cedarairsoftfield.com/",
    tags: ["Outdoor"],
  },
  {
    id: "blackops",
    name: "Black Ops Airsoft",
    location: "Bristol, WI",
    state: "WI",
    url: "https://www.blackops-airsoft.com/events.htm",
    siteUrl: "https://www.blackops-airsoft.com/",
    tags: ["Outdoor", "Urban CQB", "MilSim"],
  },
];

// ─── STATIC FIELDS (never changes, always included) ──────────────────────────
const STATIC_FIELDS = [
  {
    id: "bingfield",
    name: "Bing Field Airsoft & Paintball Park",
    location: "Alton, IL (St. Louis Metro)",
    state: "MO",
    description: "St. Louis area's premier facility. 60+ acres, 5+ acre City of Bedlam urban field. Monthly Big Games $30.",
    tags: ["Outdoor", "Big Games"],
    url: "https://bingfield.com/",
  },
  {
    id: "twincities",
    name: "Twin Cities Airsoft (TCA)",
    location: "Minneapolis/St. Paul Metro, MN",
    state: "MN",
    description: "Minnesota's premier scenario field. High Intensity Airsoft events monthly. Bio BB only. Giant Games 2x yearly.",
    tags: ["Outdoor", "Scenario Games"],
    url: "https://www.twincitiesairsoft.com/",
  },
  {
    id: "kankakee",
    name: "Kankakee Airsoft Factory",
    location: "Kankakee, IL",
    state: "IL",
    description: "7-story factory building with CQB floors + outdoor area. Hosted by MiR Tactical. Open plays Mar–Nov.",
    tags: ["Indoor", "Outdoor", "MilSim"],
    url: "https://mirtactical.com/airsoft/kankakee-factory-airsoft-open-play-hosted-by-mir-tactical/",
  },
  {
    id: "mirtactical",
    name: "MiR Tactical HQ — Buffalo Grove",
    location: "Buffalo Grove, IL",
    state: "IL",
    description: "Midwest's largest airsoft retailer & event organizer. Hosts Tier 1–3 MilSim events across Illinois.",
    tags: ["MilSim", "Indoor"],
    url: "https://mirtactical.com/",
  },
  {
    id: "blastcamp",
    name: "Blastcamp Paintball & Airsoft",
    location: "Hobart, IN",
    state: "IN",
    description: "Historic Nike Missile Base. 23 acres, monthly airsoft ops produced by Cobra Airsoft Legion.",
    tags: ["Outdoor", "MilSim"],
    url: "https://blastcamp.com/airsoft/",
  },
  {
    id: "cedar",
    name: "Cedar Airsoft Field",
    location: "Wisconsin",
    state: "WI",
    description: "~10 acres with woods, open field, CQB structures. Rec days every Saturday ($20). Multiple game modes.",
    tags: ["Outdoor"],
    url: "https://www.cedarairsoftfield.com/",
  },
  {
    id: "hellsurvivors",
    name: "Hell Survivors",
    location: "Pinckney, MI",
    state: "MI",
    description: "180-acre complex with 12 fields. Hosts Global Conquest, the Monster Game, and Tippmann World Challenge annually.",
    tags: ["Outdoor", "Major Events"],
    url: "https://www.hellsurvivors.com/",
  },
  {
    id: "kalamazoo",
    name: "Kalamazoo Airsoft",
    location: "Kalamazoo, MI",
    state: "MI",
    description: "Michigan's premier indoor/outdoor CQB facility. Home field for WolfPack Airsoft.",
    tags: ["Indoor", "Outdoor"],
    url: "https://www.airsoftc3.com/us/mi/fields",
  },
  {
    id: "jokerschurch",
    name: "Joker's Circus Airsoft",
    location: "Bloomington, IN",
    state: "IN",
    description: "Indiana's oldest active airsoft field, founded 1998. Annual Noob Day, MilSim events, open plays year-round.",
    tags: ["Outdoor", "MilSim"],
    url: "https://www.airsoftc3.com/us/in/fields",
  },
  {
    id: "i70",
    name: "i70 Paintball & Airsoft",
    location: "Huber Heights, OH",
    state: "OH",
    description: "Most popular & well-reviewed field in Ohio. Diverse terrain, rentals available.",
    tags: ["Outdoor", "MilSim"],
    url: "https://www.airsoftc3.com/us/oh/fields",
  },
  {
    id: "crossfire",
    name: "Crossfire Airsoft",
    location: "Twin Cities Metro, MN",
    state: "MN",
    description: "Oldest airsoft field in Minnesota. 30+ acres dedicated airsoft only. 5 distinct fields, weekly games.",
    tags: ["Outdoor"],
    url: "https://www.airsoftc3.com/us/mn/fields",
  },
  {
    id: "wardenoh",
    name: "War Den Airsoft",
    location: "Stone Creek, OH",
    state: "OH",
    description: "Eastern Ohio woodland field. Known for big MilSim scenario events.",
    tags: ["Outdoor", "MilSim"],
    url: "https://www.airsoftc3.com/us/oh/fields",
  },
  {
    id: "blackops",
    name: "Black Ops Airsoft",
    location: "Bristol, WI (near Kenosha / Chicago border)",
    state: "WI",
    description: "Midwest's largest pay-to-play airsoft-only field. Open year-round. Outdoor + urban town. WilSim Saturdays & MilSim events. Fri $10 · Sat–Sun $20. Rentals $15.",
    tags: ["Outdoor", "Urban CQB", "MilSim"],
    url: "https://www.blackops-airsoft.com/",
  },
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────

/**
 * Fetch a URL and return plain text (strips most HTML tags).
 * Returns null on failure so we can skip gracefully.
 */
async function fetchText(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; MidwestAirsoftBot/1.0; +https://midwestairsoft.vercel.app)",
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    // Strip tags, collapse whitespace — keeps just readable text
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim()
      .slice(0, 8000); // cap at 8k chars per source
  } catch {
    return null;
  }
}

/**
 * Ask Claude to extract structured events from raw page text.
 * Returns an array of event objects or [] on failure.
 */
async function extractEventsWithClaude(source, rawText) {
  const today = new Date().toISOString().split("T")[0];

  const prompt = `You are extracting airsoft event data from a website.

Field: ${source.name} (${source.location})
Field URL: ${source.siteUrl}
Today's date: ${today}

Raw website text:
---
${rawText}
---

Extract ALL future airsoft events mentioned (dates after ${today}).
For recurring open play days (e.g. "every Saturday"), list each individual date for the next 3 months only.

Respond with ONLY a JSON array. No explanation, no markdown fences. Each object must have:
{
  "date": "YYYY-MM-DD",           // exact date, required
  "name": "Short event name",     // required
  "type": "milsim|big|open",      // milsim=MilSim op, big=big/giant game, open=open play/rec day
  "price": "$XX",                 // optional, e.g. "$30" or "$40-50"
  "url": "https://..."            // link to event or field page
}

If no future events are found, return an empty array: []`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001", // fast + cheap for extraction
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      console.error(`Claude API error for ${source.id}:`, res.status);
      return [];
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || "[]";

    // Strip any accidental markdown fences
    const clean = text.replace(/```json|```/g, "").trim();
    const events = JSON.parse(clean);

    // Validate & tag each event with field info
    return events
      .filter((e) => e.date && e.name)
      .map((e) => ({
        date: e.date,
        name: e.name,
        type: e.type || "open",
        price: e.price || null,
        url: e.url || source.siteUrl,
        fieldId: source.id,
        fieldName: source.name,
        location: source.location,
        state: source.state,
      }));
  } catch (err) {
    console.error(`Parse error for ${source.id}:`, err.message);
    return [];
  }
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // Protect manual triggers
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secret = req.headers["authorization"] || req.query.secret;
  const isManual = req.query.secret !== undefined;

  if (isManual && secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  console.log(`[midwest-airsoft] Scrape started at ${new Date().toISOString()}`);

  const allEvents = [];
  const results = [];

  // Process each source sequentially (avoids rate limits)
  for (const source of SOURCES) {
    console.log(`  Fetching: ${source.url}`);
    const rawText = await fetchText(source.url);

    if (!rawText) {
      console.warn(`  ⚠ Could not fetch ${source.id}`);
      results.push({ id: source.id, status: "fetch_failed", events: 0 });
      continue;
    }

    const events = await extractEventsWithClaude(source, rawText);
    console.log(`  ✓ ${source.id}: ${events.length} events extracted`);
    allEvents.push(...events);
    results.push({ id: source.id, status: "ok", events: events.length });

    // Small delay between Claude calls to be polite
    await new Promise((r) => setTimeout(r, 500));
  }

  // Sort by date
  allEvents.sort((a, b) => a.date.localeCompare(b.date));

  // Remove past events
  const today = new Date().toISOString().split("T")[0];
  const futureEvents = allEvents.filter((e) => e.date >= today);

  // Build output payload
  const payload = {
    lastUpdated: new Date().toISOString(),
    nextUpdate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    fields: STATIC_FIELDS,
    events: futureEvents,
    scrapeResults: results,
  };

  // Write to public/events.json so the frontend can load it
  try {
    const outputPath = join(process.cwd(), "public", "events.json");
    await writeFile(outputPath, JSON.stringify(payload, null, 2));
    console.log(`  ✓ Written to public/events.json (${futureEvents.length} events)`);
  } catch (err) {
    console.error("  ✗ Failed to write events.json:", err.message);
    // On Vercel, filesystem writes don't persist across invocations.
    // In production you'd write to Vercel KV, Blob, or an external store.
    // See README for upgrade path.
  }

  return res.status(200).json({
    success: true,
    eventsFound: futureEvents.length,
    sources: results,
    data: payload,
  });
}
