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
  signToken, verifyToken, turnstileOr403, STRIPE_API_VERSION,
} = require('./lib');
const { StripeError, stripePost } = require('./stripe');

const UNSUBSCRIBE_TTL = 60 * 60 * 24 * 365; // 1 year
const LINK_TTL_SECONDS = 15 * 60;
const PORTAL_PURPOSE = 'portal';
const MIN_AMOUNT_CENTS = 100;
const MAX_AMOUNT_CENTS = 10_000_000; // $100k sanity ceiling
const RECENT_LIMIT = 3;

const AIRTABLE_URL = 'https://api.airtable.com/v0/appgd3KnYil6zQgHp/tblRLdlEgvV1KqqiL';

// ── POST /api/subscribe ─────────────────────────────────────────────────────
async function subscribe({ event, db, secrets, body, origin }) {
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
         zip        = excluded.zip`,
      [email, firstName || null, lastName || null, address || null, zip || null],
    );
  } catch (err) {
    console.error('[api] subscribe DB error:', err.message);
    return json({ error: 'Could not save subscription' }, 500);
  }

  // Welcome email INLINE before responding (Lambda has no waitUntil; the
  // deferral was purely latency). A send failure never blocks the signup.
  if (secrets.RESEND_API_KEY) {
    try {
      await sendWelcomeEmail(secrets, origin, email, firstName);
    } catch (err) {
      console.error('[api] welcome email failed:', err?.message);
    }
  }

  return json({ ok: true });
}

async function sendWelcomeEmail(secrets, origin, email, firstName) {
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : 'Welcome,';
  let unsubscribeUrl = `${origin}/#join`;
  if (secrets.TOKEN_SECRET) {
    const token = await signToken(secrets.TOKEN_SECRET, 'unsubscribe', email, UNSUBSCRIBE_TTL);
    unsubscribeUrl = `${origin}/api/unsubscribe?token=${encodeURIComponent(token)}`;
  }

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secrets.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Utah Civic Compact <hello@utahciviccompact.org>',
      to: [email],
      subject: "You're in. Here's what that means.",
      html: buildWelcomeEmail(greeting, unsubscribeUrl),
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    }),
  });

  if (!emailRes.ok) {
    console.error('[api] Resend error:', emailRes.status);
  }
}

function buildWelcomeEmail(greeting, unsubscribeUrl) {
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
        <p style="margin:0 0 20px;color:#2c2c2c;font-size:17px;line-height:1.7;">${greeting}</p>
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

// ── GET/POST /api/unsubscribe?token=... ─────────────────────────────────────
// POST supports RFC 8058 one-click unsubscribe from mail clients.
async function unsubscribe({ event, db, secrets }) {
  const token = event.queryStringParameters?.token;
  const email = secrets.TOKEN_SECRET ? await verifyToken(secrets.TOKEN_SECRET, 'unsubscribe', token) : null;

  if (!email) return unsubPage('This unsubscribe link is invalid or has expired.', 400);

  try {
    await db.query('DELETE FROM subscribers WHERE email = $1', [email]);
    await db.query('UPDATE members SET newsletter_opt_in = 0 WHERE email = $1', [email]);
  } catch (err) {
    console.error('[api] unsubscribe DB error:', err.message);
    return unsubPage('Something went wrong. Please email info@utahciviccompact.org.', 500);
  }

  return unsubPage("You've been unsubscribed. Sorry to see you go.");
}

function unsubPage(message, status = 200) {
  const body = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Unsubscribe | Utah Civic Compact</title>
<style>body{font-family:Georgia,serif;background:#f5f5f0;color:#2c2c2c;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}main{background:#fff;padding:40px;border-radius:8px;max-width:480px;text-align:center}a{color:#1a3a2a}</style></head>
<body><main><p>${message}</p><p><a href="/">utahciviccompact.org</a></p></main></body></html>`;
  return html(body, status);
}

// ── POST /api/tip ───────────────────────────────────────────────────────────
// Confidential tipline. NEVER log request bodies or upstream response bodies
// — they may contain the tip text or tipster email. Status codes only.
async function tip({ event, db, secrets, body }) {
  const limited = await rateLimitOr429(db, event, 'tip', 5);
  if (limited) return limited;

  if (!secrets.AIRTABLE_TOKEN) {
    console.error('[api] AIRTABLE_TOKEN is not set');
    return json({ error: 'Submission is temporarily unavailable.' }, 503);
  }

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

  // Field names must match the Airtable base exactly.
  const fields = {
    name: body.anonymous ? 'Anonymous' : str(body.name, 200),
    anonymous: Boolean(body.anonymous),
    email,
    tip_summary: tipSummary,
    subject_of_tip: str(body.subject_of_tip, 200),
    status: 'New',
  };

  let airtableRes;
  try {
    airtableRes = await fetch(AIRTABLE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secrets.AIRTABLE_TOKEN}`,
      },
      body: JSON.stringify({ fields }),
    });
  } catch (err) {
    console.error('[api] Airtable fetch failed:', err?.message);
    return json({ error: 'Submission failed. Please try again.' }, 502);
  }

  if (!airtableRes.ok) {
    // Status only — Airtable error bodies echo field values.
    console.error(`[api] Airtable error ${airtableRes.status}`);
    return json({ error: 'Submission failed. Please try again.' }, 502);
  }

  return json({ ok: true }, 200);
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

  if (!secrets.TOKEN_SECRET || !secrets.RESEND_API_KEY) {
    console.error('[api] portal: TOKEN_SECRET or RESEND_API_KEY not set');
    return json({ error: 'Portal is temporarily unavailable' }, 503);
  }

  await selfInvoke({ job: 'portal-link', email, origin });

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
    await sendPortalLink(secrets.RESEND_API_KEY, email, link);
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

    const res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secrets.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Stripe-Version': STRIPE_API_VERSION,
      },
      body: new URLSearchParams({
        customer: member.stripe_customer_id,
        return_url: `${origin}/#donate`,
      }),
    });

    const session = await res.json();
    if (!res.ok) {
      console.error('[api] Stripe portal error:', res.status, session.error?.type);
      return json({ error: 'Could not open billing portal' }, 502);
    }

    return redirect(session.url, 302);
  } catch (err) {
    console.error('[api] create-portal-session error:', err);
    return json({ error: 'Internal error' }, 500);
  }
}

// Most recent real Stripe customer for this email (ignores any legacy
// pending_ placeholder rows). ORDER BY created_at — UUID ids are unordered
// (the D1 original used ORDER BY id; migration carries created_at over).
async function findMember(db, email) {
  const res = await db.query(
    `SELECT stripe_customer_id FROM members
     WHERE email = $1 AND stripe_customer_id LIKE 'cus_%'
     ORDER BY created_at DESC, legacy_id DESC LIMIT 1`,
    [email],
  );
  return res.rows[0] || null;
}

async function sendPortalLink(apiKey, email, link) {
  const safeLink = escapeHtml(link);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Utah Civic Compact <hello@utahciviccompact.org>',
      to: [email],
      subject: 'Manage your Utah Civic Compact membership',
      html: `<p>Use the link below to manage your recurring donation. It expires in 15 minutes.</p>
<p><a href="${safeLink}">${safeLink}</a></p>
<p>If you didn't request this, you can ignore this email.</p>`,
    }),
  });
  if (!res.ok) console.error('[api] Resend error:', res.status);
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
  subscribe, unsubscribe, tip, createCheckoutSession,
  createPortalSessionPost, createPortalSessionGet, portalLinkJob, donationStats,
};
