/**
 * /api/scrape.js
 *
 * Vercel Serverless Function — runs weekly via cron (Monday 6am UTC)
 * Can also be triggered manually: GET /api/scrape?secret=YOUR_SECRET
 *
 * Flow:
 *   1. Fetch raw HTML from each field website
 *   2. Send relevant text to Groq API for structured event extraction
 *   3. Merge with static fields data
 *   4. Write events.json to /public/ so the frontend can load it
 *
 * Env vars needed in Vercel dashboard:
 *   GROQ_API_KEY   — your Groq API key (free tier)
 *   CRON_SECRET    — any random string to protect manual trigger
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
    state: "IL",
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
    state: "IL",
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
  // Illinois — new fields
  { id: "legacy_lockport", name: "Legacy Paintball and Airsoft Park", location: "Lockport, IL", state: "IL", description: "Established paintball & airsoft park in the southwest Chicago suburbs. Open play and group events.", tags: ["Outdoor"], url: "https://www.airsoftc3.com/us/il/fields" },
  { id: "urban_warfare_bl", name: "Urban Warfare Paintball", location: "Bloomington, IL", state: "IL", description: "Central Illinois field offering urban-style paintball and airsoft scenarios.", tags: ["Outdoor"], url: "https://www.airsoftc3.com/us/il/fields" },
  { id: "saltfork", name: "Saltfork Paintball", location: "St. Joseph, IL", state: "IL", description: "East-central Illinois paintball & airsoft field. Wooded terrain with multiple game zones.", tags: ["Outdoor"], url: "https://www.airsoftc3.com/us/il/fields" },
  { id: "sinnissippi", name: "Sinnissippi Airsoft", location: "Sterling, IL", state: "IL", description: "Rod & Gun Club-hosted airsoft field in northwest Illinois. Community-run with regular game days.", tags: ["Outdoor"], url: "https://www.airsoftc3.com/us/il/fields" },
  { id: "pbx", name: "Paintball Explosion (PBX)", location: "East Dundee, IL", state: "IL", description: "Northwest Chicago suburb field running paintball & airsoft. Multiple field layouts, walk-on friendly.", tags: ["Outdoor"], url: "https://www.airsoftc3.com/us/il/fields" },
  { id: "ronin_cordova", name: "Ronin Airsoft Home Field", location: "Cordova, IL", state: "IL", description: "Team-run private airsoft field in western Illinois. Community events and organized game days.", tags: ["Outdoor"], url: "https://www.airsoftc3.com/us/il/fields" },
  // Indiana — new fields
  { id: "surge_strike", name: "Surge Strike Airsoft", location: "Auburn, IN", state: "IN", description: "One of Indiana's biggest complexes — 50,000 sqft indoor + 160 acres outdoor. Major ops and open play.", tags: ["Indoor", "Outdoor", "MilSim"], url: "https://www.airsoftc3.com/us/in/fields" },
  { id: "htk_airsoft", name: "HTK Airsoft", location: "Jasper, IN", state: "IN", description: "Southern Indiana airsoft field. Regular game days and community events in Dubois County.", tags: ["Outdoor"], url: "https://www.airsoftc3.com/us/in/fields" },
  { id: "shotzone", name: "ShotZone", location: "Martinsville, IN", state: "IN", description: "Competitive SpeedSoft-focused field south of Indianapolis. Fast-paced format, regular tournaments.", tags: ["Outdoor", "SpeedSoft"], url: "https://www.airsoftc3.com/us/in/fields" },
  { id: "silver_spur", name: "Silver Spur Splat", location: "Princeton, IN", state: "IN", description: "Southwest Indiana paintball & airsoft field. Open play and events in Gibson County.", tags: ["Outdoor"], url: "https://www.airsoftc3.com/us/in/fields" },
  { id: "boneyard_in", name: "The Boneyard", location: "Bloomington, IN", state: "IN", description: "South-central Indiana airsoft field. Woodland gameplay and open play events near IU's campus.", tags: ["Outdoor"], url: "https://www.airsoftc3.com/us/in/fields" },
  { id: "meat_grinder", name: "Blackops Meat Grinder", location: "Goshen, IN", state: "IN", description: "Northern Indiana airsoft field known for intense gameplay. Regular ops and open play in Elkhart County.", tags: ["Outdoor", "MilSim"], url: "https://www.airsoftc3.com/us/in/fields" },
  { id: "paintball_plex", name: "Paintball Plex", location: "LaOtto, IN", state: "IN", description: "Northeast Indiana paintball & airsoft complex. Multiple field layouts, open play and group events.", tags: ["Outdoor"], url: "https://www.airsoftc3.com/us/in/fields" },
  // Ohio — new fields
  { id: "g2_tactical", name: "G2 Tactical", location: "Springfield, OH", state: "OH", description: "Massive 180-acre airsoft complex in western Ohio. One of the largest fields in the state.", tags: ["Outdoor", "MilSim"], url: "https://www.airsoftc3.com/us/oh/fields" },
  { id: "sektor7", name: "Sektor7 Airsoft", location: "Lorain, OH", state: "OH", description: "40-acre airsoft-only field on Lake Erie. Dedicated airsoft terrain with regular game days.", tags: ["Outdoor"], url: "https://www.airsoftc3.com/us/oh/fields" },
  { id: "den_airsoft", name: "The Den Airsoft", location: "New Philadelphia, OH", state: "OH", description: "Northeast Ohio airsoft field serving the Tuscarawas Valley. Woodland and open terrain.", tags: ["Outdoor"], url: "https://www.airsoftc3.com/us/oh/fields" },
  { id: "splatter_park", name: "Splatter Park", location: "Mount Gilead, OH", state: "OH", description: "Central Ohio paintball & airsoft park. Multiple field layouts for all skill levels.", tags: ["Outdoor"], url: "https://www.airsoftc3.com/us/oh/fields" },
  { id: "patriots_ridge", name: "Patriots Ridge Airsoft", location: "Bellefontaine, OH", state: "OH", description: "West-central Ohio airsoft field. MilSim-focused events on wooded terrain.", tags: ["Outdoor", "MilSim"], url: "https://www.airsoftc3.com/us/oh/fields" },
  { id: "parkers_airsoft", name: "Parkers Airsoft Field", location: "Bethel, OH", state: "OH", description: "Southwest Ohio airsoft field near Cincinnati. Open play and events on wooded terrain.", tags: ["Outdoor"], url: "https://www.airsoftc3.com/us/oh/fields" },
  { id: "underground_wars", name: "Underground Wars", location: "Newark, OH", state: "OH", description: "Central Ohio indoor CQB airsoft arena. Fast-paced close-quarters gameplay.", tags: ["Indoor"], url: "https://www.airsoftc3.com/us/oh/fields" },
  { id: "fallen_warrior", name: "Fallen Warrior Airsoft", location: "Chillicothe, OH", state: "OH", description: "100-acre airsoft field in south-central Ohio. Large-scale MilSim ops on expansive terrain.", tags: ["Outdoor", "MilSim"], url: "https://www.airsoftc3.com/us/oh/fields" },
  { id: "big_pearl", name: "Big Pearl Paintball", location: "Conneaut, OH", state: "OH", description: "Northeast Ohio paintball & airsoft field near Lake Erie. Wooded terrain and multiple courses.", tags: ["Outdoor"], url: "https://www.airsoftc3.com/us/oh/fields" },
  // Michigan — new fields
  { id: "tc_paintball_north", name: "TC Paintball North", location: "Copemish, MI", state: "MI", description: "55-acre northern Michigan paintball & airsoft complex. Large wooded terrain with multiple zones.", tags: ["Outdoor"], url: "https://www.airsoftc3.com/us/mi/fields" },
  { id: "futureball", name: "Futureball", location: "Whitmore Lake, MI", state: "MI", description: "35+ years running — one of Michigan's oldest continuously operating paintball and airsoft fields.", tags: ["Outdoor"], url: "https://www.airsoftc3.com/us/mi/fields" },
  { id: "darkfire", name: "DarkFire Airsoft", location: "Coldwater, MI", state: "MI", description: "South Michigan airsoft field. Woodland terrain and regular game days.", tags: ["Outdoor"], url: "https://www.airsoftc3.com/us/mi/fields" },
  { id: "mtac", name: "Michigan Tactical Airsoft Center (MTAC)", location: "Redford, MI", state: "MI", description: "15,000 sqft indoor CQB arena in the Detroit metro. Realistic urban environments.", tags: ["Indoor"], url: "https://www.airsoftc3.com/us/mi/fields" },
  { id: "west_mi_airsoft", name: "West Michigan Airsoft", location: "Ravenna, MI", state: "MI", description: "West Michigan community-run airsoft field. Regular game days serving the Grand Rapids area.", tags: ["Outdoor"], url: "https://www.airsoftc3.com/us/mi/fields" },
  { id: "phoenix_tactical", name: "Phoenix Tactical", location: "Clinton Twp, MI", state: "MI", description: "Metro Detroit area tactical airsoft field. MilSim events and open play in Macomb County.", tags: ["Outdoor", "MilSim"], url: "https://www.airsoftc3.com/us/mi/fields" },
  // Minnesota — new fields
  { id: "special_forces_mn", name: "Special Forces Paintball", location: "Buffalo, MN", state: "MN", description: "West Metro Minnesota paintball & airsoft. Woodland and speedball layouts west of the Twin Cities.", tags: ["Outdoor"], url: "https://www.airsoftc3.com/us/mn/fields" },
  { id: "mn_pro_paintball", name: "MN Pro Paintball", location: "Lakeville, MN", state: "MN", description: "South Metro Minnesota field with multiple course layouts. Regular events year-round.", tags: ["Outdoor"], url: "https://www.airsoftc3.com/us/mn/fields" },
  // Wisconsin — new fields
  { id: "action_sports_wi", name: "Action Sports Wisconsin", location: "Mauston, WI", state: "WI", description: "Massive 80-acre complex with 40 shipping containers. One of the most unique fields in the Midwest.", tags: ["Outdoor", "MilSim"], url: "https://www.airsoftc3.com/us/wi/fields" },
  { id: "airsoft_arena_mil", name: "Airsoft Arena", location: "Milwaukee, WI", state: "WI", description: "Wisconsin's largest indoor airsoft facility at 40,000 sqft. Year-round CQB gameplay.", tags: ["Indoor"], url: "https://www.airsoftc3.com/us/wi/fields" },
  { id: "commando_pb", name: "Commando Paintball", location: "Little Suamico, WI", state: "WI", description: "Northeast Wisconsin paintball & airsoft near Green Bay. Wooded courses with regular open play.", tags: ["Outdoor"], url: "https://www.airsoftc3.com/us/wi/fields" },
  { id: "edge_janesville", name: "Edge Paintball and Airsoft", location: "Janesville, WI", state: "WI", description: "South Wisconsin field serving the Janesville/Beloit area. Open play and events.", tags: ["Outdoor"], url: "https://www.airsoftc3.com/us/wi/fields" },
  // Missouri — new fields
  { id: "sogo_airsoft", name: "So Go Airsoft", location: "Ozark, MO", state: "MO", description: "Southwest Missouri airsoft field near Springfield. Open play and events in Christian County.", tags: ["Outdoor"], url: "https://www.airsoftc3.com/us/mo/fields" },
  { id: "rock_airsoft", name: "The Rock Airsoft", location: "Bolivar, MO", state: "MO", description: "Central Missouri airsoft field. Outdoor terrain with regular game days.", tags: ["Outdoor"], url: "https://www.airsoftc3.com/us/mo/fields" },
  { id: "mass_mo", name: "MASS — Missouri Airsoft Simulation Site", location: "Lawson, MO", state: "MO", description: "Northwest Missouri MilSim-focused airsoft. Dedicated simulation site with scenario-based ops.", tags: ["Outdoor", "MilSim"], url: "https://www.airsoftc3.com/us/mo/fields" },
  { id: "huckleberry_ridge", name: "Huckleberry Ridge Airsoft", location: "Pineville, MO", state: "MO", description: "Southwest Missouri airsoft in the Ozarks. Rugged wooded terrain near the Arkansas border.", tags: ["Outdoor"], url: "https://www.airsoftc3.com/us/mo/fields" },
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
 * Ask Groq to extract structured events from raw page text.
 * Uses Groq free tier with llama-3.1-8b-instant.
 * Returns an array of event objects or [] on failure.
 */
async function extractEventsWithGroq(source, rawText) {
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
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      console.error(`Groq API error for ${source.id}:`, res.status);
      return [];
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || "[]";

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

    const events = await extractEventsWithGroq(source, rawText);
    console.log(`  ✓ ${source.id}: ${events.length} events extracted`);
    allEvents.push(...events);
    results.push({ id: source.id, status: "ok", events: events.length });

    // Small delay between Gemini calls to be polite
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
