'use strict';
// The six non-webhook routes, ported from functions/api/ (spec §10).
// Behavior preserved line-by-line; deltas from the Cloudflare originals:
//   - D1 (?) binds → pg ($n); INSERT gets explicit gen_random_uuid() ids
//   - context.waitUntil is gone: the subscribe welcome email sends INLINE
//     (the deferral was latency-only); the portal magic-link lookup+send
//     moves to an async self-invocation so the 202 stays timing-safe
//   - Turnstile added to subscribe + tip (the one net-new control)
//   - /api/donations/stats returns only `recent` (org decision: no public
//     total/goal — docs/build-spec-aws.md addendum 2)
const {
  json, html, redirect, escapeHtml, isValidEmail, str, rateLimitOr429,
  signToken, verifyToken, turnstileOr403,
} = require('./lib');
const { StripeError, stripePost } = require('./stripe');
const { utahZipSql, isUtahZip } = require('@uccsite/db/audience');
const {
  buildPetitionThanksEmail, buildDonationThanksEmail, formatAmount, formatDate, donationType, receiptHtml, fillHtml, fillText,
} = require('./emails');

const UNSUBSCRIBE_TTL = 60 * 60 * 24 * 365; // 1 year
const LINK_TTL_SECONDS = 15 * 60;
const PORTAL_PURPOSE = 'portal';
const MIN_AMOUNT_CENTS = 100;
const MAX_AMOUNT_CENTS = 10_000_000; // $100k sanity ceiling
const RECENT_LIMIT = 3;

// ── POST /api/subscribe ─────────────────────────────────────────────────────
async function subscribe(ctx) {
  const { event, db, secrets, body, origin } = ctx;
  const limited = await rateLimitOr429(db, event, 'subscribe', 5);
  if (limited) return limited;

  if (body === undefined) return json({ error: 'Invalid request body' }, 400);

  const blocked = await turnstileOr403(secrets.TURNSTILE_SECRET_KEY, event, body.turnstileToken);
  if (blocked) return blocked;

  const email = str(body.email, 254).toLowerCase();
  const firstName = str(body.firstName, 100);
  const lastName = str(body.lastName, 100);
  const address = str(body.address, 200);
  const zip = str(body.zip, 10);

  if (!isValidEmail(email)) {
    return json({ error: 'A valid email address is required' }, 400);
  }

  // Upsert — if they sign up again, update their info but don't error
  try {
    await db.query(
      `INSERT INTO subscribers (id, email, first_name, last_name, address, zip)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
       ON CONFLICT (email) DO UPDATE SET
         first_name = excluded.first_name,
         last_name  = excluded.last_name,
         address    = excluded.address,
         zip        = excluded.zip,
         -- Someone who unsubscribed and signs up again starts over: back on
         -- the list once they press the confirm button in the new welcome email.
         confirmed_at = CASE WHEN subscribers.unsubscribed_at IS NULL THEN subscribers.confirmed_at END,
         unsubscribed_at = NULL,
         unsubscribed_by = NULL`,
      [email, firstName || null, lastName || null, address || null, zip || null],
    );
  } catch (err) {
    console.error('[api] subscribe DB error:', err.message);
    return json({ error: 'Could not save subscription' }, 500);
  }

  // Welcome email via async self-invocation — off the response path like the
  // Cloudflare waitUntil original. Inline sending meant a provider stall held
  // the user's response (and each retry burned a rate-limit slot).
  if (ctx.selfInvoke) {
    try {
      await ctx.selfInvoke({ job: 'welcome-email', email, firstName, origin });
    } catch (err) {
      console.error('[api] welcome email dispatch failed:', err?.message);
    }
  }

  return json({ ok: true });
}

// ── OPTIONS /api/subscribe ── CORS preflight from the officials lookup;
// index.mjs adds Allow-Origin + Vary (lib.js withLookupCors).
function subscribePreflight() {
  return {
    statusCode: 204,
    headers: {
      'Access-Control-Allow-Methods': 'POST',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
    body: '',
  };
}

// Runs from the self-invocation (unreachable over HTTP — see index.mjs).
async function welcomeEmailJob({ secrets, email, firstName, origin }) {
  try {
    await sendWelcomeEmail(secrets, origin, email, firstName);
  } catch (err) {
    console.error('[api] welcome email failed:', err?.message);
  }
}

// THE send path — both transactional emails go through it. Amazon SES v2
// (docs/systems/email.md): auth is the Lambda role (ses:SendEmail on the
// domain identity, From pinned by IAM condition), so there is no API key to
// be unset — if sending is broken it is IAM or SES, and the error says so.
// SES_CONFIGURATION_SET (prod: ucc-prod) routes bounces/complaints to the
// ops topic; staging sends without one.
const FROM_ADDRESS = 'Utah Civic Compact <hello@utahciviccompact.org>';
const EMAIL_TIMEOUT_MS = 8000;

let sesClient = null;
function getSesClient() {
  if (!sesClient) {
    const { SESv2Client } = require('@aws-sdk/client-sesv2');
    sesClient = new SESv2Client({ requestHandler: { requestTimeout: EMAIL_TIMEOUT_MS } });
  }
  return sesClient;
}
// Tests swap in a fake; never called in production.
function _setSesClient(client) { sesClient = client; }

async function sesSend({ to, subject, html, text, headers }) {
  const { SendEmailCommand } = require('@aws-sdk/client-sesv2');
  const configSet = process.env.SES_CONFIGURATION_SET;
  const input = {
    FromEmailAddress: FROM_ADDRESS,
    Destination: { ToAddresses: [to] },
    Content: {
      Simple: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: { Html: { Data: html, Charset: 'UTF-8' }, ...(text ? { Text: { Data: text, Charset: 'UTF-8' } } : {}) },
        ...(headers ? { Headers: Object.entries(headers).map(([Name, Value]) => ({ Name, Value })) } : {}),
      },
    },
    ...(configSet ? { ConfigurationSetName: configSet } : {}),
  };
  try {
    const res = await getSesClient().send(new SendEmailCommand(input));
    console.log(`[api] SES sent ${res.MessageId} subject="${subject}"`);
  } catch (err) {
    // Recipient never logged. err.name is the SES/IAM error class
    // (AccessDeniedException, MessageRejected, AccountSuspendedException ...).
    console.error('[api] SES error:', err?.name, err?.message);
  }
}

// Double opt-in (docs/systems/newsletters.md "Confirmed subscribers"): the
// welcome email carries a signed confirm link; the newsletter audience only
// includes join-form rows with confirmed_at set. The link lasts 30 days.
const CONFIRM_TTL = 60 * 60 * 24 * 30;

async function sendWelcomeEmail(secrets, origin, email, firstName) {
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : 'Welcome,';
  let unsubscribeUrl = `${origin}/#join`;
  let confirmUrl = '';
  // One-click headers only with a real signed link — never advertise
  // List-Unsubscribe-Post on a URL that cannot unsubscribe.
  let headers;
  if (secrets.TOKEN_SECRET) {
    const token = await signToken(secrets.TOKEN_SECRET, 'unsubscribe', email, UNSUBSCRIBE_TTL);
    unsubscribeUrl = `${origin}/api/unsubscribe?token=${encodeURIComponent(token)}`;
    const confirmToken = await signToken(secrets.TOKEN_SECRET, 'confirm', email, CONFIRM_TTL);
    confirmUrl = `${origin}/api/confirm?token=${encodeURIComponent(confirmToken)}`;
    headers = {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
  }

  await sesSend({
    to: email,
    subject: "You're in. Here's what that means.",
    html: buildWelcomeEmail(greeting, unsubscribeUrl, confirmUrl),
    headers,
  });
}

function buildWelcomeEmail(greeting, unsubscribeUrl, confirmUrl = '') {
  const confirmBlock = confirmUrl ? `
        <p style="margin:0 0 12px;color:#2c2c2c;font-size:17px;line-height:1.7;">
          <strong>One click to confirm:</strong> press the button so we know this address is yours. Until you do, we won't send the newsletter here.
        </p>
        <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
          <tr><td style="background:#c8a84b;border-radius:4px;">
            <a href="${escapeHtml(confirmUrl)}" style="display:inline-block;padding:14px 28px;color:#1a3a2a;font-family:sans-serif;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:0.5px;">
              Yes, that's me &rarr;
            </a>
          </td></tr>
        </table>` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Welcome to Utah Civic Compact</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f0;font-family:'Georgia',serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f0;padding:40px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">

      <!-- Header -->
      <tr><td style="background:#1a3a2a;padding:36px 40px;">
        <p style="margin:0;color:#c8a84b;font-size:12px;letter-spacing:3px;text-transform:uppercase;">Utah Civic Compact</p>
        <h1 style="margin:8px 0 0;color:#ffffff;font-size:28px;font-weight:400;line-height:1.3;">
          Democracy is not a spectator sport.
        </h1>
      </td></tr>

      <!-- Body -->
      <tr><td style="padding:40px;">
        <p style="margin:0 0 20px;color:#2c2c2c;font-size:17px;line-height:1.7;">${greeting}</p>${confirmBlock}
        <p style="margin:0 0 20px;color:#2c2c2c;font-size:17px;line-height:1.7;">
          You didn't sign up for a newsletter. You joined a compact, and we mean that.
        </p>
        <p style="margin:0 0 20px;color:#2c2c2c;font-size:17px;line-height:1.7;">
          A lot of us looked at how politics works in Utah and decided we weren't okay with it. Not outraged. Just done waiting for it to fix itself. This is what we're building instead.
        </p>
        <p style="margin:0 0 20px;color:#2c2c2c;font-size:17px;line-height:1.7;">
          You're a founding member.
        </p>
        <p style="margin:0 0 32px;color:#2c2c2c;font-size:17px;line-height:1.7;">
          We're going to ask things of you. Not constantly, not with a donation button every third email. But when something matters and your voice can move it, we'll tell you. That's the deal. And it goes both ways. You need us, we'll show up.
        </p>
        <p style="margin:0 0 32px;color:#2c2c2c;font-size:17px;line-height:1.7;">
          Welcome. Tell someone.
        </p>
        <table cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
          <tr><td style="background:#1a3a2a;border-radius:4px;">
            <a href="https://utahciviccompact.org" style="display:inline-block;padding:14px 28px;color:#ffffff;font-family:sans-serif;font-size:15px;font-weight:600;text-decoration:none;letter-spacing:0.5px;">
              utahciviccompact.org &rarr;
            </a>
          </td></tr>
        </table>
        <table cellpadding="0" cellspacing="0">
          <tr><td style="background:#4a154b;border-radius:4px;">
            <a href="https://join.slack.com/t/utahciviccompact/shared_invite/zt-3xj2m02aq-BVUgI_0DshSwsEsfWy9DIg" style="display:inline-block;padding:14px 28px;color:#ffffff;font-family:sans-serif;font-size:15px;font-weight:600;text-decoration:none;letter-spacing:0.5px;">
              Join our Slack &rarr;
            </a>
          </td></tr>
        </table>
      </td></tr>

      <!-- Footer -->
      <tr><td style="background:#f5f5f0;padding:24px 40px;border-top:1px solid #e8e4d9;">
        <p style="margin:0;color:#888;font-family:sans-serif;font-size:12px;line-height:1.6;">
          Utah Civic Compact &middot; Salt Lake City, UT<br />
          You're getting this because you signed up at utahciviccompact.org.<br />
          <a href="${escapeHtml(unsubscribeUrl)}" style="color:#1a3a2a;">Unsubscribe</a>
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ── GET /api/open?c=<newsletter id> ─────────────────────────────────────────
// Campaign-level open counter (docs/systems/newsletters.md "Opens"): the
// pixel URL carries ONLY the newsletter id — no recipient, no token — so a
// row says "someone opened issue X", never who. No IP, no user agent. The
// count is inflated by Apple Mail's prefetch and undercounts image-blocking
// clients; the admin says so beside the number.
const GIF_1X1 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const NEWSLETTER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
async function newsletterOpen({ event, db }) {
  const id = String(event.queryStringParameters?.c || '').toLowerCase();
  if (NEWSLETTER_ID_RE.test(id)) {
    try {
      await db.query('INSERT INTO newsletter_opens (id, newsletter_id) VALUES (gen_random_uuid(), $1)', [id]);
    } catch (err) {
      console.error('[api] open DB error:', err.message); // still serve the pixel
    }
  }
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, private', 'X-Robots-Tag': 'noindex' },
    body: GIF_1X1,
    isBase64Encoded: true,
  };
}

// ── GET /api/confirm?token=... ───────────────────────────────────────────────
// Double opt-in: marks the join-form subscriber confirmed. Idempotent; an
// expired or forged token gets the same page with a different message.
async function confirmSubscription({ event, db, secrets }) {
  const token = event.queryStringParameters?.token || '';
  const email = secrets.TOKEN_SECRET ? await verifyToken(secrets.TOKEN_SECRET, 'confirm', token) : null;
  if (!email) return unsubPage('This confirmation link is invalid or has expired. Sign up again at utahciviccompact.org and we will send a fresh one.', 400, 'Confirm');
  try {
    await db.query('UPDATE subscribers SET confirmed_at = COALESCE(confirmed_at, now()) WHERE email = $1', [email]);
  } catch (err) {
    console.error('[api] confirm DB error:', err.message);
    return unsubPage('Something went wrong on our end. Please try the link again in a minute.', 500, 'Confirm');
  }
  console.log('[api] subscriber confirmed');
  return unsubPage("Confirmed — you're on the list. Welcome to the Compact.", 200, 'Confirmed');
}

// ── GET/POST /api/unsubscribe?token=... ─────────────────────────────────────
// POST unsubscribes: RFC 8058 one-click from mail clients (body
// `List-Unsubscribe=One-Click`, token in the URL) or the button below.
// GET only shows that button — link scanners and inbox prefetchers GET every
// URL in a message, so a GET that unsubscribed would drop real readers.
async function unsubscribe({ event, db, secrets }) {
  const token = event.queryStringParameters?.token;
  const email = secrets.TOKEN_SECRET ? await verifyToken(secrets.TOKEN_SECRET, 'unsubscribe', token) : null;

  if (!email) return unsubPage('This unsubscribe link is invalid or has expired.', 400);

  if (event.requestContext.http.method !== 'POST') {
    return unsubPage(`Stop Utah Civic Compact emails to ${escapeHtml(email)}?</p>
<form method="post" action="/api/unsubscribe?token=${encodeURIComponent(token)}"><button type="submit">Unsubscribe</button></form><p>`);
  }

  // Soft: the row stays, stamped unsubscribed_at / unsubscribed_by = 'self',
  // so the admin's Mailing list shows who left and when (the audience query
  // skips it). The admin's "Erase record" is the hard delete.
  try {
    await db.query(`UPDATE subscribers SET unsubscribed_at = COALESCE(unsubscribed_at, now()), unsubscribed_by = COALESCE(unsubscribed_by, 'self') WHERE email = $1`, [email]);
    await db.query('UPDATE members SET newsletter_opt_in = 0 WHERE email = $1', [email]);
  } catch (err) {
    console.error('[api] unsubscribe DB error:', err.message);
    return unsubPage('Something went wrong. Please email info@utahciviccompact.org.', 500);
  }

  return unsubPage("You've been unsubscribed. Sorry to see you go.");
}

function unsubPage(message, status = 200, title = 'Unsubscribe') {
  const body = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} | Utah Civic Compact</title>
<style>body{font-family:Georgia,serif;background:#f5f5f0;color:#2c2c2c;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}main{background:#fff;padding:40px;border-radius:8px;max-width:480px;text-align:center}a{color:#1a3a2a}</style></head>
<body><main><p>${message}</p><p><a href="/">utahciviccompact.org</a></p></main></body></html>`;
  return html(body, status);
}

// ── POST /api/tip ───────────────────────────────────────────────────────────
// Confidential tipline → the `tips` table (Airtable retired,
// docs/migration/airtable-retirement-plan.md). NEVER log request bodies or
// database error messages — pg errors can echo parameter values. Status
// codes and error NAMES only.
async function tip({ event, db, secrets, body }) {
  const limited = await rateLimitOr429(db, event, 'tip', 5);
  if (limited) return limited;

  if (body === undefined) return json({ error: 'Invalid request body' }, 400);

  const blocked = await turnstileOr403(secrets.TURNSTILE_SECRET_KEY, event, body.turnstileToken);
  if (blocked) return blocked;

  const email = str(body.email, 200).toLowerCase();
  const tipSummary = str(body.tip_summary, 100000);

  if (!isValidEmail(email)) {
    return json({ error: 'A valid email address is required.' }, 400);
  }
  if (!tipSummary) {
    return json({ error: 'Tip details are required.' }, 400);
  }

  const anonymous = Boolean(body.anonymous);
  try {
    await db.query(
      `INSERT INTO tips (id, name, anonymous, email, subject_of_tip, tip_summary, status)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'New')`,
      [
        anonymous ? 'Anonymous' : str(body.name, 200),
        anonymous ? 1 : 0,
        email,
        str(body.subject_of_tip, 200),
        tipSummary,
      ],
    );
  } catch (err) {
    console.error(`[api] tip insert failed: ${err?.name || 'Error'}`);
    return json({ error: 'Submission failed. Please try again.' }, 500);
  }

  return json({ ok: true }, 200);
}

// ── POST /api/petition ──────────────────────────────────────────────────────
// Petition signature (docs/systems/petition.md). `petition` is the campaign
// slug the page carries (content-driven, pattern-validated — no allowlist, so
// a new campaign needs no API change). One row per email per campaign: a
// re-sign refreshes the details and keeps the original created_at. Signing
// is consent to future communications (the form says so), so the signer is
// also upserted into subscribers WITHOUT overwriting details they gave on
// the join form. No welcome email — the thank-you page is the acknowledgment.
const PETITION_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ZIP_RE = /^\d{5}(-\d{4})?$/;
const PETITION_LIMIT = 20; // per IP per hour — one phone at a tabling event signs many

async function petitionSign({ event, db, secrets, body, origin, selfInvoke }) {
  const limited = await rateLimitOr429(db, event, 'petition', PETITION_LIMIT);
  if (limited) return limited;

  if (body === undefined) return json({ error: 'Invalid request body' }, 400);

  const blocked = await turnstileOr403(secrets.TURNSTILE_SECRET_KEY, event, body.turnstileToken);
  if (blocked) return blocked;

  const petition = str(body.petition, 64).toLowerCase();
  const firstName = str(body.firstName, 100);
  const lastName = str(body.lastName, 100);
  const email = str(body.email, 254).toLowerCase();
  const zip = str(body.zip, 10);
  const address = str(body.address, 200);
  const phone = str(body.phone, 30);

  if (!PETITION_SLUG_RE.test(petition)) return json({ error: 'Unknown petition' }, 400);
  if (!firstName || !lastName) return json({ error: 'First and last name are required' }, 400);
  if (!ZIP_RE.test(zip)) return json({ error: 'A 5-digit ZIP code is required' }, 400);
  if (!isValidEmail(email)) return json({ error: 'A valid email address is required' }, 400);

  // The campaign this slug belongs to (project filing + email copy). Null
  // when the slug is not the live campaign or the read fails — the signature
  // is still recorded, just without a project.
  const campaign = await petitionCampaign(db, petition);

  let isNew = true;
  try {
    // First signature or a re-sign? Decides the thank-you email below: one
    // per address per petition, so a re-sign can never be used to flood an
    // inbox (the route is reachable by anyone who knows an email address).
    const prior = await db.query(
      'SELECT 1 FROM petition_signatures WHERE petition = $1 AND email = $2',
      [petition, email],
    );
    isNew = !(prior.rows && prior.rows.length);
    await db.query(
      `INSERT INTO petition_signatures (id, petition, first_name, last_name, email, zip, address, phone, project_slug)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (petition, email) DO UPDATE SET
         first_name = excluded.first_name,
         last_name  = excluded.last_name,
         zip        = excluded.zip,
         address    = COALESCE(excluded.address, petition_signatures.address),
         phone      = COALESCE(excluded.phone, petition_signatures.phone),
         project_slug = COALESCE(excluded.project_slug, petition_signatures.project_slug),
         updated_at = now()`,
      [petition, firstName, lastName, email, zip, address || null, phone || null, campaign?.project_slug || null],
    );
    await db.query(
      `INSERT INTO subscribers (id, email, first_name, last_name, address, zip, confirmed_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, now())
       ON CONFLICT (email) DO UPDATE SET
         first_name = COALESCE(subscribers.first_name, excluded.first_name),
         last_name  = COALESCE(subscribers.last_name, excluded.last_name),
         address    = COALESCE(subscribers.address, excluded.address),
         zip        = COALESCE(subscribers.zip, excluded.zip),
         confirmed_at = COALESCE(subscribers.confirmed_at, now()),
         unsubscribed_at = NULL,
         unsubscribed_by = NULL`,
      [email, firstName, lastName, address || null, zip],
    );
  } catch (err) {
    // Error NAME only — pg messages can echo parameter values (signer PII).
    console.error(`[api] petition insert failed: ${err?.name || 'Error'}`);
    return json({ error: 'Could not record your signature. Please try again.' }, 500);
  }

  // A Utah signature may have changed the public counter — drop the cached
  // number so the next page load recounts (petitionCount below).
  if (isUtahZip(zip)) invalidateCount(petition);

  // Thank-you email, first signature only, off the response path (same
  // self-invoke pattern as the welcome email). A failed dispatch is logged
  // and the signer still gets {ok:true} — the signature is what matters.
  if (isNew && selfInvoke) {
    try {
      await selfInvoke({ job: 'petition-thanks', email, firstName, petition, origin });
    } catch (err) {
      console.error('[api] petition thanks dispatch failed:', err?.message);
    }
  }
  return json({ ok: true });
}

// ── Campaign lookup (homepage.petition) ─────────────────────────────────────
// The API role may SELECT the homepage singleton and the projects table
// (read-only, public content — docs/systems/api-security.md). Returns the
// petition group when its slug is the one asked for (headline for the email,
// project_slug to file the signature), with `project` ({name, url}) resolved
// from project_slug; null for any other slug (an editor may be drafting the
// next campaign while the live one is still being signed) and on any error
// (logged by name — the caller falls back to generic copy).
// Cached per container for CAMPAIGN_TTL_MS: it is read on every signature.
const CAMPAIGN_TTL_MS = 5 * 60_000;
let campaignCache = null; // { at, group, project }
function _resetCampaignCache() { campaignCache = null; templateCache.clear(); }

// Attached emails (docs/systems/email.md "Attached emails"): an admin can
// attach a newsletter composed in the admin to a trigger; its frozen subject/
// html/text sit in transactional_emails (api role: SELECT). Null = no
// attachment or a failed read → the built-in body below is used. {tokens}
// are filled here (emails.js fillHtml), the unsubscribe token by the caller.
const UNSUBSCRIBE_TOKEN = '{{unsubscribe_url}}';
const templateCache = new Map(); // trigger → { at, row }
async function transactionalTemplate(db, trigger) {
  const hit = templateCache.get(trigger);
  if (hit && Date.now() - hit.at < CAMPAIGN_TTL_MS) return hit.row;
  try {
    const res = await db.query('SELECT subject, html, text FROM transactional_emails WHERE trigger = $1', [trigger]);
    const row = (res.rows && res.rows[0]) || null;
    templateCache.set(trigger, { at: Date.now(), row });
    return row;
  } catch (err) {
    console.error(`[api] attached email lookup failed (${trigger}): ${err?.name || 'Error'}`);
    return null;
  }
}
// fillAttached(row, vars, raw, unsubscribeUrl) → { subject, html, text }
function fillAttached(row, vars, raw = {}, unsubscribeUrl = '') {
  const sub = (s) => (unsubscribeUrl ? String(s || '').split(UNSUBSCRIBE_TOKEN).join(unsubscribeUrl) : String(s || ''));
  return {
    subject: fillText(row.subject, vars),
    html: sub(fillHtml(row.html, { text: vars, raw })),
    text: sub(fillText(row.text || '', vars)),
  };
}

async function petitionCampaign(db, slug) {
  try {
    if (!campaignCache || Date.now() - campaignCache.at > CAMPAIGN_TTL_MS) {
      const { loadHomepage } = require('@uccsite/db/content');
      const group = (await loadHomepage(db)).petition || null;
      let project = null;
      const projectSlug = String(group?.project_slug || '').trim();
      if (group && projectSlug) {
        const rows = (await db.query('SELECT slug, name, parent_slug FROM projects')).rows;
        const p = rows.find((r) => r.slug === projectSlug);
        if (p) {
          const parent = String(p.parent_slug || '').trim();
          project = { name: p.name, url: `/projects/${parent ? `${parent}/` : ''}${p.slug}` };
        }
      }
      campaignCache = { at: Date.now(), group, project };
    }
    const { group, project } = campaignCache;
    if (!group || String(group.slug || '').toLowerCase() !== slug) return null;
    return { ...group, project_slug: project ? String(group.project_slug).trim() : null, project };
  } catch (err) {
    console.error('[api] petition campaign lookup failed:', err?.name || 'Error');
    return null;
  }
}

// Runs from the self-invocation (index.mjs JOBS 'petition-thanks').
async function petitionThanksJob({ db, secrets, email, firstName, petition, origin }) {
  try {
    const campaign = await petitionCampaign(db, String(petition || '').toLowerCase());
    let unsubscribeUrl = `${origin}/#join`;
    if (secrets.TOKEN_SECRET) {
      const token = await signToken(secrets.TOKEN_SECRET, 'unsubscribe', email, UNSUBSCRIBE_TTL);
      unsubscribeUrl = `${origin}/api/unsubscribe?token=${encodeURIComponent(token)}`;
    }
    const attached = await transactionalTemplate(db, 'petition-thanks');
    const built = attached
      ? fillAttached(attached, {
        first_name: firstName || 'there',
        headline: String(campaign?.headline || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
        project_name: campaign?.project?.name || '',
      }, {}, unsubscribeUrl)
      : buildPetitionThanksEmail({ firstName, campaign, project: campaign?.project || null, origin, unsubscribeUrl });
    await sesSend({
      to: email, ...built,
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });
  } catch (err) {
    console.error('[api] petition thanks email failed:', err?.message);
  }
}

// Runs from the self-invocation (index.mjs JOBS 'donation-thanks'), dispatched
// by the Stripe webhook on checkout.session.completed (webhook.js).
async function donationThanksJob({ db, email, firstName, amountCents, recurring, origin }) {
  try {
    const attached = await transactionalTemplate(db, 'donation-thanks');
    let built;
    if (attached) {
      const amount = formatAmount(amountCents);
      const date = formatDate();
      built = fillAttached(attached,
        { first_name: firstName || 'there', amount: amount || 'gift', type: donationType(Boolean(recurring)), date },
        { receipt: receiptHtml({ amount, recurring: Boolean(recurring), date }) });
    } else {
      built = buildDonationThanksEmail({ firstName, amountCents, recurring: Boolean(recurring), origin });
    }
    await sesSend({ to: email, ...built });
  } catch (err) {
    console.error('[api] donation thanks email failed:', err?.message);
  }
}

// ── GET /api/petition/count?petition=<slug> ─────────────────────────────────
// Public signature counter for the hero and /petition: UTAH signers only
// (ZIP 84xxx — packages/db/audience.js utahZipSql; the org counts Utahns,
// out-of-state supporters are kept but not shown). EVENT-DRIVEN, not timed
// (org decision 2026-10-05): the page fetches once per load, the Lambda
// answers from a per-container cache, and a new Utah signature CLEARS that
// cache (petitionSign → invalidateCount) so the next load is exact. The
// TTL below is only a safety net for other warm containers that did not
// see the signature; no response is browser-cached.
const COUNT_TTL_MS = 10 * 60_000;
const countCache = new Map(); // slug → { count, at }
function invalidateCount(petition) { countCache.delete(petition); }

async function petitionCount({ event, db }) {
  const petition = str(event.queryStringParameters?.petition, 64).toLowerCase();
  if (!PETITION_SLUG_RE.test(petition)) return json({ error: 'Unknown petition' }, 400);
  const hit = countCache.get(petition);
  if (hit && Date.now() - hit.at < COUNT_TTL_MS) return countJson(petition, hit.count);
  try {
    const res = await db.query(
      `SELECT count(*)::int AS n FROM petition_signatures WHERE petition = $1 AND ${utahZipSql('zip')}`,
      [petition],
    );
    const count = res.rows[0]?.n ?? 0;
    countCache.set(petition, { count, at: Date.now() });
    return countJson(petition, count);
  } catch (err) {
    console.error('[api] petition count error:', err?.name || 'Error');
    return json({ error: 'Internal error' }, 500);
  }
}

function countJson(petition, count) {
  return json({ petition, count }); // no-store: freshness comes from invalidation, not a timer
}

// ── POST /api/create-checkout-session ───────────────────────────────────────
async function createCheckoutSession({ event, db, secrets, body, origin }) {
  const limited = await rateLimitOr429(db, event, 'checkout', 10);
  if (limited) return limited;

  if (body === undefined) return json({ error: 'Invalid request body' }, 400);

  const { type, amountCents, newsletterOptIn, publicDonor } = body;
  const email = str(body.email, 254).toLowerCase();
  const firstName = str(body.firstName, 100);
  const lastName = str(body.lastName, 100);
  const zip = str(body.zip, 10);
  // Where the ask came from (e.g. 'petition:<slug>'); Stripe metadata only.
  const source = str(body.source, 80).replace(/[^\w:.-]/g, '');

  if (!['subscription', 'onetime'].includes(type)) {
    return json({ error: 'Invalid type' }, 400);
  }

  const cents = parseInt(amountCents, 10);
  if (!cents || cents < MIN_AMOUNT_CENTS || cents > MAX_AMOUNT_CENTS) {
    return json({ error: 'Invalid amount' }, 400);
  }

  if (email && !isValidEmail(email)) {
    return json({ error: 'Invalid email address' }, 400);
  }

  try {
    const isSub = type === 'subscription';

    const priceData = {
      currency: 'usd',
      unit_amount: cents,
      product_data: {
        name: isSub ? 'Monthly Membership — Utah Civic Compact' : 'Donation — Utah Civic Compact',
      },
    };
    if (isSub) priceData.recurring = { interval: 'month' };

    const metadata = {
      firstName,
      lastName,
      zip,
      newsletterOptIn: newsletterOptIn ? '1' : '0',
      publicDonor: publicDonor === false ? '0' : '1',
    };
    if (source) metadata.source = source;

    const sessionParams = {
      mode: isSub ? 'subscription' : 'payment',
      line_items: [{ price_data: priceData, quantity: 1 }],
      success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/#donate`,
      metadata,
    };

    if (isSub) {
      // Carry donor prefs onto the subscription so invoice.paid can honor them.
      sessionParams.subscription_data = { metadata };
    } else {
      // Always create a Customer so the webhook can link the donation to a member.
      sessionParams.customer_creation = 'always';
    }

    if (email) sessionParams.customer_email = email;

    const session = await stripePost(secrets.STRIPE_SECRET_KEY, 'checkout/sessions', sessionParams);
    return json({ url: session.url });
  } catch (err) {
    if (err instanceof StripeError && err.status < 500) {
      return json({ error: err.message }, 400);
    }
    console.error('[api] create-checkout-session error:', err);
    return json({ error: 'Internal error' }, 500);
  }
}

// ── /api/create-portal-session ──────────────────────────────────────────────
// POST { email } → always 202 once past the input gates. The member lookup
// and email send happen in an async self-invocation of this same Lambda so
// response timing cannot leak membership (Lambda has no waitUntil; the
// invoke payload is identical for every accepted request).
async function createPortalSessionPost({ event, db, secrets, body, origin, selfInvoke }) {
  const limited = await rateLimitOr429(db, event, 'portal', 5);
  if (limited) return limited;

  if (body === undefined) return json({ error: 'Invalid request body' }, 400);

  const email = str(body.email, 254).toLowerCase();
  if (!isValidEmail(email)) return json({ error: 'A valid email address is required' }, 400);

  if (!secrets.TOKEN_SECRET) {
    console.error('[api] portal: TOKEN_SECRET not set');
    return json({ error: 'Portal is temporarily unavailable' }, 503);
  }

  try {
    await selfInvoke({ job: 'portal-link', email, origin });
  } catch (err) {
    // The 202 contract holds even if the dispatch fails (e.g. throttling) —
    // a 500 here would break the constant-response guarantee.
    console.error('[api] portal link dispatch failed:', err?.message);
  }

  return json({ ok: true, message: 'If that email is on file, a sign-in link has been sent.' }, 202);
}

// The deferred half — runs from the self-invocation (never reachable over
// HTTP; the router only dispatches jobs on events with no requestContext.http).
async function portalLinkJob({ db, secrets, email, origin }) {
  try {
    const member = await findMember(db, email);
    if (!member) return;
    const token = await signToken(secrets.TOKEN_SECRET, PORTAL_PURPOSE, email, LINK_TTL_SECONDS);
    const link = `${origin}/api/create-portal-session?token=${encodeURIComponent(token)}`;
    await sendPortalLink(email, link);
  } catch (err) {
    console.error('[api] portal link send failed:', err?.message);
  }
}

async function createPortalSessionGet({ event, db, secrets, origin }) {
  const token = event.queryStringParameters?.token;
  const email = secrets.TOKEN_SECRET ? await verifyToken(secrets.TOKEN_SECRET, PORTAL_PURPOSE, token) : null;
  if (!email) return json({ error: 'This link is invalid or has expired. Request a new one.' }, 400);

  try {
    const member = await findMember(db, email);
    if (!member) return json({ error: 'No account found' }, 404);

    // Through the shared stripePost — one place owns the pinned API version.
    const session = await stripePost(secrets.STRIPE_SECRET_KEY, 'billing_portal/sessions', {
      customer: member.stripe_customer_id,
      return_url: `${origin}/#donate`,
    });
    return redirect(session.url, 302);
  } catch (err) {
    if (err instanceof StripeError) {
      console.error('[api] Stripe portal error:', err.status);
      return json({ error: 'Could not open billing portal' }, 502);
    }
    console.error('[api] create-portal-session error:', err);
    return json({ error: 'Internal error' }, 500);
  }
}

// Most recent real Stripe customer for this email (ignores any legacy
// pending_ placeholder rows). ORDER BY created_at — UUID ids are unordered
// (the D1 original used ORDER BY id; migration carries created_at over).
// No legacy_id reference: that column is migration scaffolding and gets
// dropped after cutover verification.
async function findMember(db, email) {
  const res = await db.query(
    `SELECT stripe_customer_id FROM members
     WHERE email = $1 AND stripe_customer_id LIKE 'cus_%'
     ORDER BY created_at DESC LIMIT 1`,
    [email],
  );
  return res.rows[0] || null;
}

async function sendPortalLink(email, link) {
  const safeLink = escapeHtml(link);
  await sesSend({
    to: email,
    subject: 'Manage your Utah Civic Compact membership',
    html: `<p>Use the link below to manage your recurring donation. It expires in 15 minutes.</p>
<p><a href="${safeLink}">${safeLink}</a></p>
<p>If you didn't request this, you can ignore this email.</p>`,
  });
}

// ── GET /api/donations/stats ────────────────────────────────────────────────
// Org policy (2026-09-12): no public total or goal — recent opt-in donors only.
async function donationStats({ db }) {
  try {
    const recentRows = await db.query(
      `SELECT m.first_name, d.amount_cents
       FROM donations d
       LEFT JOIN members m ON d.member_id = m.id
       WHERE d.public = 1
       ORDER BY d.created_at DESC
       LIMIT $1`,
      [RECENT_LIMIT],
    );

    const recent = recentRows.rows.map(row => ({
      firstName: row.first_name || 'Anonymous',
      amountCents: row.amount_cents,
    }));

    return json({ recent }, 200, { 'Cache-Control': 'public, max-age=60' });
  } catch (err) {
    console.error('[api] donations/stats error:', err.message);
    return json({ error: 'Internal error' }, 500);
  }
}

module.exports = {
  subscribe, subscribePreflight, unsubscribe, confirmSubscription, newsletterOpen, tip, petitionSign, petitionCount, createCheckoutSession,
  createPortalSessionPost, createPortalSessionGet, portalLinkJob, welcomeEmailJob, donationStats,
  petitionThanksJob, donationThanksJob,
  _setSesClient, _resetCampaignCache,
};
