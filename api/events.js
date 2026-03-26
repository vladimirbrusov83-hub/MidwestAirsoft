/**
 * /api/events.js
 *
 * Serves events data to the frontend.
 * The cron job (update-events.js) commits fresh data to
 * public/events-seed.json every Wednesday → Vercel redeploys → this
 * file always returns up-to-date events with no database needed.
 */

import SEED_DATA from '../public/events-seed.json' with { type: 'json' };

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).json(SEED_DATA);
}
