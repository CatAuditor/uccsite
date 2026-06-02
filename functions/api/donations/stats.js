const DEFAULT_GOAL_CENTS = 100000; // $1,000 — override with DONATION_GOAL_CENTS env var
const RECENT_LIMIT = 5;

export async function onRequestGet({ env }) {
  if (!env.DB) {
    return json({ error: 'Database unavailable' }, 503);
  }

  try {
    const goalCents = parseInt(env.DONATION_GOAL_CENTS, 10) || DEFAULT_GOAL_CENTS;

    const [totalsRow, recentRows] = await Promise.all([
      env.DB.prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS total_cents FROM donations`).first(),
      env.DB.prepare(
        `SELECT m.first_name, d.amount_cents
         FROM donations d
         LEFT JOIN members m ON d.member_id = m.id
         WHERE d.public = 1
         ORDER BY d.created_at DESC
         LIMIT ?`
      ).bind(RECENT_LIMIT).all(),
    ]);

    const recent = (recentRows.results || []).map(row => ({
      firstName: row.first_name || 'Anonymous',
      amountCents: row.amount_cents,
    }));

    return json({
      totalCents: totalsRow.total_cents,
      goalCents,
      recent,
    });
  } catch (err) {
    console.error('donations/stats error:', err);
    return json({ error: 'Internal error' }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60',
    },
  });
}
