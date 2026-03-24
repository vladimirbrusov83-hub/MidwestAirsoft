/**
 * /api/events.js
 *
 * Public endpoint that serves the latest events data.
 * The frontend fetches /api/events instead of a static file
 * because Vercel's filesystem doesn't persist between function runs.
 *
 * Storage strategy (choose one, see README):
 *   Option A — Vercel KV (recommended, free tier available)
 *   Option B — Vercel Blob
 *   Option C — GitHub raw file (scrape.js commits events.json to your repo)
 *
 * This file implements Option A (Vercel KV).
 * If you haven't set up KV yet, it falls back to the bundled seed data.
 */

// Seed data shown on first load before any scrape has run
import SEED_DATA from "../public/events-seed.json" with { type: "json" };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");

  // ── Try Vercel KV first ──────────────────────────────────────────────────
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const kvRes = await fetch(
        `${process.env.KV_REST_API_URL}/get/midwest-airsoft-events`,
        {
          headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
        }
      );
      const kv = await kvRes.json();
      if (kv.result) {
        const data = JSON.parse(kv.result);
        return res.status(200).json(data);
      }
    } catch (err) {
      console.warn("KV read failed, using seed:", err.message);
    }
  }

  // ── Fallback: return seed data ───────────────────────────────────────────
  return res.status(200).json(SEED_DATA);
}
