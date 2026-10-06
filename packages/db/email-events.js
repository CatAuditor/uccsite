'use strict';
// SES delivery events per address (docs/systems/newsletters.md "Bounces and
// complaints"). The SesEventsFn Lambda (aws/ses-events) receives the
// configuration set's BOUNCE / COMPLAINT / REJECT events from the ops SNS
// topic and records one row per recipient. `suppress = 1` marks the address
// as one the audience must skip (hard bounce, complaint, or SES's own
// account-suppression bounce); soft bounces are recorded but not suppressing.
const DDL = [
  `CREATE TABLE IF NOT EXISTS email_events (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL,
    type TEXT NOT NULL,
    subtype TEXT,
    suppress INTEGER NOT NULL DEFAULT 0,
    message_id TEXT,
    detail TEXT,
    at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_email_events_email ON email_events(email)`,
];

// SQL predicate (for the audience query): the address has a suppressing event.
const SUPPRESSED_SQL = (emailExpr) => `EXISTS (SELECT 1 FROM email_events ee WHERE ee.email = ${emailExpr} AND ee.suppress = 1)`;

// classify(sesEvent) → [{ email, type, subtype, suppress, messageId, detail }]
// for one SES event-publishing payload (eventType Bounce | Complaint | Reject).
function classify(ev) {
  const type = String(ev?.eventType || ev?.notificationType || '').toLowerCase();
  const messageId = ev?.mail?.messageId || null;
  const out = [];
  if (type === 'bounce') {
    const b = ev.bounce || {};
    const hard = b.bounceType === 'Permanent';
    for (const r of b.bouncedRecipients || []) {
      out.push({ email: String(r.emailAddress || '').toLowerCase(), type: 'bounce', subtype: `${b.bounceType || ''}/${b.bounceSubType || ''}`, suppress: hard ? 1 : 0, messageId, detail: r.diagnosticCode || '' });
    }
  } else if (type === 'complaint') {
    const c = ev.complaint || {};
    for (const r of c.complainedRecipients || []) {
      out.push({ email: String(r.emailAddress || '').toLowerCase(), type: 'complaint', subtype: c.complaintFeedbackType || '', suppress: 1, messageId, detail: '' });
    }
  } else if (type === 'reject') {
    for (const d of ev.mail?.destination || []) {
      out.push({ email: String(d || '').toLowerCase(), type: 'reject', subtype: ev.reject?.reason || '', suppress: 0, messageId, detail: '' });
    }
  }
  return out.filter((e) => e.email.includes('@'));
}

async function recordEvents(client, events) {
  for (const e of events) {
    await client.query(
      `INSERT INTO email_events (id, email, type, subtype, suppress, message_id, detail) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
      [e.email, e.type, e.subtype || null, e.suppress ? 1 : 0, e.messageId || null, e.detail ? String(e.detail).slice(0, 500) : null]);
  }
}

// suppressionFor(client, emails) → Map<email, 'bounce'|'complaint'>
async function suppressionFor(client, emails) {
  if (!emails.length) return new Map();
  const res = await client.query(`SELECT email, type FROM email_events WHERE suppress = 1 AND email = ANY($1::text[])`, [emails]);
  return new Map(res.rows.map((r) => [r.email, r.type]));
}

// latestEvents(client, limit) → recent rows for the Mailing list page.
async function latestEvents(client, limit = 200) {
  const res = await client.query(`SELECT email, type, subtype, suppress, detail, at::text AS at FROM email_events ORDER BY at DESC LIMIT $1`, [limit]);
  return res.rows;
}

module.exports = { DDL, SUPPRESSED_SQL, classify, recordEvents, suppressionFor, latestEvents };
