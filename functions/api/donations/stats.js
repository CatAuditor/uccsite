import { json } from '../_lib.js';

// Org policy (2026-09-12): no public running total or goal — this endpoint
// exposes only the opt-in recent-donor list. See docs/build-spec-aws.md,
// planning addendum 2.
const RECENT_LIMIT = 3;

export async function onRequestGet({ env }) {
  if (!env.DB) {
    return json({ error: 'Database unavailable' }, 503);
  }

  try {
    const recentRows = await env.DB.prepare(
      `SELECT m.first_name, d.amount_cents
       FROM donations d
       LEFT JOIN members m ON d.member_id = m.id
       WHERE d.public = 1
       ORDER BY d.created_at DESC
       LIMIT ?`
    ).bind(RECENT_LIMIT).all();

    const recent = (recentRows.results || []).map(row => ({
      firstName: row.first_name || 'Anonymous',
      amountCents: row.amount_cents,
    }));

    return json({ recent }, 200, { 'Cache-Control': 'public, max-age=60' });
  } catch (err) {
    console.error('donations/stats error:', err);
    return json({ error: 'Internal error' }, 500);
  }
}
