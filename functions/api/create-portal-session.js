// Stripe billing portal access via emailed magic link.
//
//   POST /api/create-portal-session  { email }
//     Always responds 202. If the email belongs to a member, a short-lived
//     signed link is emailed to that address. No account enumeration.
//
//   GET  /api/create-portal-session?token=...
//     Verifies the token, mints a Stripe portal session, 302s to it.
//
// Requires secrets: STRIPE_SECRET_KEY, RESEND_API_KEY, TOKEN_SECRET.

import { json, isValidEmail, str, escapeHtml, rateLimitOr429, signToken, verifyToken, STRIPE_API_VERSION } from './_lib.js';

const LINK_TTL_SECONDS = 15 * 60;
const PURPOSE = 'portal';

export async function onRequestPost(context) {
  const { request, env } = context;

  const limited = await rateLimitOr429(env, request, 'portal', 5);
  if (limited) return limited;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  const email = str(body.email, 254).toLowerCase();
  if (!isValidEmail(email)) return json({ error: 'A valid email address is required' }, 400);

  if (!env.TOKEN_SECRET || !env.RESEND_API_KEY) {
    console.error('Portal: TOKEN_SECRET or RESEND_API_KEY not set');
    return json({ error: 'Portal is temporarily unavailable' }, 503);
  }

  const accepted = json({ ok: true, message: 'If that email is on file, a sign-in link has been sent.' }, 202);

  // Do the lookup + send after responding so timing doesn't leak membership.
  context.waitUntil((async () => {
    try {
      const member = await findMember(env.DB, email);
      if (!member) return;
      const token = await signToken(env.TOKEN_SECRET, PURPOSE, email, LINK_TTL_SECONDS);
      const origin = new URL(request.url).origin;
      const link = `${origin}/api/create-portal-session?token=${encodeURIComponent(token)}`;
      await sendLink(env.RESEND_API_KEY, email, link);
    } catch (err) {
      console.error('Portal link send failed:', err?.message);
    }
  })());

  return accepted;
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const email = env.TOKEN_SECRET ? await verifyToken(env.TOKEN_SECRET, PURPOSE, url.searchParams.get('token')) : null;
  if (!email) return json({ error: 'This link is invalid or has expired. Request a new one.' }, 400);

  try {
    const member = await findMember(env.DB, email);
    if (!member) return json({ error: 'No account found' }, 404);

    const res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Stripe-Version': STRIPE_API_VERSION,
      },
      body: new URLSearchParams({
        customer: member.stripe_customer_id,
        return_url: `${url.origin}/#donate`,
      }),
    });

    const session = await res.json();
    if (!res.ok) {
      console.error('Stripe portal error:', res.status, session.error?.type);
      return json({ error: 'Could not open billing portal' }, 502);
    }

    return Response.redirect(session.url, 302);
  } catch (err) {
    console.error('create-portal-session error:', err);
    return json({ error: 'Internal error' }, 500);
  }
}

// Most recent real Stripe customer for this email (ignores any legacy pending_ placeholder rows).
async function findMember(db, email) {
  return db.prepare(
    `SELECT stripe_customer_id FROM members
     WHERE email = ? AND stripe_customer_id LIKE 'cus_%'
     ORDER BY id DESC LIMIT 1`
  ).bind(email).first();
}

async function sendLink(apiKey, email, link) {
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
  if (!res.ok) console.error('Resend error:', res.status);
}
