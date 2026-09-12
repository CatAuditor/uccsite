// Cloudflare Pages Function — /api/tip
// Receives tip form data, validates it, and creates a record in Airtable.
// Requires AIRTABLE_TOKEN to be set as a Cloudflare Pages secret:
//   wrangler pages secret put AIRTABLE_TOKEN
//
// Airtable target:
//   Base:  appgd3KnYil6zQgHp  (Tip Intake)
//   Table: tblRLdlEgvV1KqqiL  (Tips)
//
// Logging policy: this is a confidential tipline. Never log request bodies or
// upstream response bodies — they may contain the tip text or tipster email.

import { json, isValidEmail, str, rateLimitOr429 } from './_lib.js';

const AIRTABLE_URL =
  "https://api.airtable.com/v0/appgd3KnYil6zQgHp/tblRLdlEgvV1KqqiL";

export async function onRequestPost({ request, env }) {
  const limited = await rateLimitOr429(env, request, 'tip', 5);
  if (limited) return limited;

  if (!env.AIRTABLE_TOKEN) {
    console.error("AIRTABLE_TOKEN is not set");
    return json({ error: "Submission is temporarily unavailable." }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  const email = str(body.email, 200).toLowerCase();
  const tipSummary = str(body.tip_summary, 100000);

  if (!isValidEmail(email)) {
    return json({ error: "A valid email address is required." }, 400);
  }
  if (!tipSummary) {
    return json({ error: "Tip details are required." }, 400);
  }

  // Field names must match the Airtable base exactly.
  // Read-only fields (tip_id, date_received, created_by_user, etc.) are omitted.
  const fields = {
    name:           body.anonymous ? "Anonymous" : str(body.name, 200),
    anonymous:      Boolean(body.anonymous),
    email,
    tip_summary:    tipSummary,
    subject_of_tip: str(body.subject_of_tip, 200),
    status:         "New",
  };

  let airtableRes;
  try {
    airtableRes = await fetch(AIRTABLE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
      },
      body: JSON.stringify({ fields }),
    });
  } catch (err) {
    console.error("Airtable fetch failed:", err?.message);
    return json({ error: "Submission failed. Please try again." }, 502);
  }

  if (!airtableRes.ok) {
    // Status only — Airtable error bodies echo field values.
    console.error(`Airtable error ${airtableRes.status}`);
    return json({ error: "Submission failed. Please try again." }, 502);
  }

  return json({ ok: true }, 200);
}
