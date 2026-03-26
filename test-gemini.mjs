/**
 * Debug test — verifies Groq API extraction works end-to-end.
 * Run: GROQ_API_KEY=your_key node test-gemini.mjs
 */

const API_KEY = process.env.GROQ_API_KEY;
if (!API_KEY) {
  console.error("❌ GROQ_API_KEY env var is not set");
  process.exit(1);
}

const testSource = {
  id: "blackops",
  name: "Black Ops Airsoft",
  location: "Bristol, WI",
  siteUrl: "https://www.blackops-airsoft.com/",
};

// Fake page text simulating what we'd scrape
const sampleText = `
  Black Ops Airsoft Events
  Open Play every Friday $10 and Saturday/Sunday $20
  April 5 2026 - Spring MilSim Op "Iron Fist" - $45 per player
  April 12 2026 - Big Game Saturday - $25
  May 3 2026 - Memorial Weekend MilSim - $50
  Check blackops-airsoft.com/events.htm for registration
`;

const today = new Date().toISOString().split("T")[0];

const prompt = `You are extracting airsoft event data from a website.

Field: ${testSource.name} (${testSource.location})
Field URL: ${testSource.siteUrl}
Today's date: ${today}

Raw website text:
---
${sampleText}
---

Extract ALL future airsoft events mentioned (dates after ${today}).
For recurring open play days (e.g. "every Saturday"), list each individual date for the next 3 months only.

Respond with ONLY a JSON array. No explanation, no markdown fences. Each object must have:
{
  "date": "YYYY-MM-DD",
  "name": "Short event name",
  "type": "milsim|big|open",
  "price": "$XX",
  "url": "https://..."
}

If no future events are found, return an empty array: []`;

console.log("🔍 Testing Groq API...\n");

try {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  console.log(`HTTP status: ${res.status} ${res.statusText}`);

  if (!res.ok) {
    const err = await res.text();
    console.error("❌ Groq API error:\n", err);
    process.exit(1);
  }

  const data = await res.json();
  const rawText = data.choices?.[0]?.message?.content || "[]";

  console.log("Raw Gemini response:\n", rawText, "\n");

  const clean = rawText.replace(/```json|```/g, "").trim();
  const events = JSON.parse(clean);

  console.log(`✅ Parsed ${events.length} events:\n`);
  events.forEach((e) => {
    console.log(`  ${e.date} | ${e.type.padEnd(6)} | ${e.name} | ${e.price ?? "free"}`);
  });
} catch (err) {
  console.error("❌ Error:", err.message);
  process.exit(1);
}
