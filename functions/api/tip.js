// Cloudflare Pages Function — /api/tip
// Receives tip form data, validates it, and creates a record in Airtable.
// Requires AIRTABLE_TOKEN to be set as a Cloudflare Pages secret:
//   wrangler pages secret put AIRTABLE_TOKEN
//
// Airtable target:
//   Base:  appgd3KnYil6zQgHp  (Tip Intake)
//   Table: tblRLdlEgvV1KqqiL  (Tips)

const AIRTABLE_URL =
  "https://api.airtable.com/v0/appgd3KnYil6zQgHp/tblRLdlEgvV1KqqiL";

export async function onRequestPost(context) {
  const { request, env } = context;

  // Rate limiting — reuse the same D1-backed helper pattern as subscribe.js
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  try {
    if (env.DB && !await checkRateLimit(env.DB, ip, "tip", 5, 3600)) {
      return json({ error: "Too many requests. Please try again later." }, 429);
    }
  } catch (err) {
    console.error("Rate limit check failed:", err);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  // ── Validation ──────────────────────────────────────────────────────────────
  const email = (body.email || "").trim().toLowerCase();
  const tipSummary = (body.tip_summary || "").trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "A valid email address is required." }, 400);
  }
  if (!tipSummary) {
    return json({ error: "Tip details are required." }, 400);
  }

  // ── Field mapping → Airtable ─────────────────────────────────────────────
  // Field names must match the Airtable base exactly.
  // Read-only fields (tip_id, date_received, created_by_user, etc.) are omitted.
  // Attachments require public URLs; wire in after adding a file-upload step.
  const fields = {
    name:           body.anonymous ? "Anonymous" : (body.name || "").trim().slice(0, 200),
    anonymous:      Boolean(body.anonymous),
    email:          email.slice(0, 200),
    tip_summary:    tipSummary.slice(0, 100000),
    subject_of_tip: (body.subject_of_tip || "").trim().slice(0, 200),
    status:         "New",
  };

  // ── Airtable REST API call ───────────────────────────────────────────────
  let airtableRes;
  try {
    airtableRes = await fetch(AIRTABLE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // AIRTABLE_TOKEN is a Cloudflare Pages secret — never exposed to the browser
        Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
      },
      body: JSON.stringify({ fields }),
    });
  } catch (err) {
    console.error("Airtable fetch failed:", err);
    return json({ error: "Submission failed. Please try again." }, 502);
  }

  if (!airtableRes.ok) {
    const detail = await airtableRes.text().catch(() => "");
    console.error(`Airtable error ${airtableRes.status}:`, detail);
    return json({ error: "Submission failed. Please try again." }, 502);
  }

  return json({ ok: true }, 200);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      // Allow only same-origin POSTs
      "Access-Control-Allow-Origin": "same-origin",
    },
  });
}

// Reuse the same rate-limit pattern as subscribe.js (D1-backed)
async function checkRateLimit(db, key, action, maxRequests, windowSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - windowSeconds;
  const id = `${action}:${key}`;

  try {
    await db.prepare(
      `INSERT INTO rate_limits (id, action, timestamp) VALUES (?, ?, ?)`
    ).bind(id, action, now).run();
  } catch {}

  const { results } = await db.prepare(
    `SELECT COUNT(*) as count FROM rate_limits
     WHERE id = ? AND timestamp > ?`
  ).bind(id, windowStart).all();

  await db.prepare(
    `DELETE FROM rate_limits WHERE timestamp < ?`
  ).bind(windowStart).run();

  return (results[0]?.count ?? 0) <= maxRequests;
}
