'use strict';
// Port of functions/api/_lib.js for the Lambda runtime (build-spec-aws.md §10).
// Line-by-line where possible: the WebCrypto HMAC token code is byte-identical
// (Node ≥18 exposes crypto.subtle globally), so tokens signed by the
// Cloudflare stack verify here and vice versa — TOKEN_SECRET carries over
// unchanged. Responses are Lambda Function URL objects instead of Response.

// Pinned Stripe API version. webhook.js reads invoice.subscription / invoice.payment_intent,
// which later versions moved under invoice.parent / invoice.payments.
const STRIPE_API_VERSION = '2024-06-20';

function json(data, status = 200, extraHeaders = {}) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extraHeaders },
    body: JSON.stringify(data),
  };
}

function html(body, status = 200, extraHeaders = {}) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders },
    body,
  };
}

function redirect(location, status = 302) {
  return { statusCode: status, headers: { Location: location, 'Cache-Control': 'no-store' }, body: '' };
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(email) {
  return typeof email === 'string' && email.length <= 254 && EMAIL_RE.test(email);
}

function str(v, max) {
  return (typeof v === 'string' ? v : '').trim().slice(0, max);
}

// Client IP behind CloudFront: the origin request policy forwards all viewer
// headers except Host; CloudFront APPENDS the real connecting IP as the LAST
// X-Forwarded-For entry (earlier entries are client-supplied and spoofable).
// Empirically verified on staging 2026-09-12: a request through the
// distribution recorded the machine's actual public IP, not a CloudFront
// edge address — the Function URL frontend does not append its own hop.
function clientIp(event) {
  const xff = event.headers?.['x-forwarded-for'];
  if (!xff) return 'unknown';
  const parts = xff.split(',').map(s => s.trim()).filter(Boolean);
  return parts[parts.length - 1] || 'unknown';
}

// Sliding-window rate limit backed by the DSQL `rate_limits` table.
// Returns true if the request is allowed. Throws on DB error — callers decide fail-open/closed.
// The expired-row purge is opportunistic (~2% of requests) rather than every
// request: the COUNT below already ignores expired rows, and a global DELETE
// per request was three round trips plus a 40001 contention point under burst.
async function checkRateLimit(db, ip, endpoint, limit, windowSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - windowSeconds;
  if (Math.random() < 0.02) {
    await db.query('DELETE FROM rate_limits WHERE timestamp < $1', [windowStart]);
  }
  const row = await db.query(
    'SELECT COUNT(*)::int AS count FROM rate_limits WHERE ip = $1 AND endpoint = $2 AND timestamp > $3',
    [ip, endpoint, windowStart],
  );
  if ((row.rows[0]?.count ?? 0) >= limit) return false;
  await db.query(
    'INSERT INTO rate_limits (id, ip, endpoint, timestamp) VALUES (gen_random_uuid(), $1, $2, $3)',
    [ip, endpoint, now],
  );
  return true;
}

// Convenience: returns a 429 response if limited, otherwise null. Fails open
// on DB error (logged) — BY DESIGN, do not "fix" to fail closed (spec §10).
async function rateLimitOr429(db, event, endpoint, limit, windowSeconds = 3600) {
  if (!db) return null;
  const ip = clientIp(event);
  try {
    if (!await checkRateLimit(db, ip, endpoint, limit, windowSeconds)) {
      return json({ error: 'Too many requests. Please try again later.' }, 429);
    }
  } catch (err) {
    console.error(`[api] rate limit check failed (${endpoint}):`, err.message);
  }
  return null;
}

// ── HMAC tokens (used for portal magic links / unsubscribe) ────────────────
// THE implementation lives in @uccsite/tokens (shared with the periodical
// script); byte-identical to functions/api/_lib.js — existing 1-year
// unsubscribe links must keep verifying.
const { signToken, verifyToken } = require('@uccsite/tokens');

// ── Turnstile (the one net-new abuse control, spec §10) ─────────────────────
// Verifies a Cloudflare Turnstile token server-side. Returns null when the
// check passes OR when no secret is configured (deploy-before-keys grace —
// the rate limiter still applies); a JSON error response otherwise.
async function turnstileOr403(secretKey, event, token) {
  if (!secretKey) return null;
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: secretKey,
        response: String(token || ''),
        remoteip: clientIp(event),
      }),
    });
    const data = await res.json();
    if (data.success) return null;
    return json({ error: 'Verification failed. Please try again.' }, 403);
  } catch (err) {
    // Same fail-open posture as the rate limiter: a Cloudflare outage must
    // not take the forms down.
    console.error('[api] turnstile verify failed:', err.message);
    return null;
  }
}

module.exports = {
  STRIPE_API_VERSION, json, html, redirect, escapeHtml, isValidEmail, str,
  clientIp, checkRateLimit, rateLimitOr429, signToken, verifyToken, turnstileOr403,
};
