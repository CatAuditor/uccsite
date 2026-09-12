// Shared helpers for Pages Functions. Files prefixed with `_` are not routed.

// Pinned Stripe API version. webhook.js reads invoice.subscription / invoice.payment_intent,
// which later versions moved under invoice.parent / invoice.payments.
export const STRIPE_API_VERSION = '2024-06-20';

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(email) {
  return typeof email === 'string' && email.length <= 254 && EMAIL_RE.test(email);
}

export function str(v, max) {
  return (typeof v === 'string' ? v : '').trim().slice(0, max);
}

// Sliding-window rate limit backed by the D1 `rate_limits` table (schema.sql).
// Returns true if the request is allowed. Throws on DB error — callers decide fail-open/closed.
export async function checkRateLimit(db, ip, endpoint, limit, windowSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - windowSeconds;
  await db.prepare('DELETE FROM rate_limits WHERE timestamp < ?').bind(windowStart).run();
  const row = await db.prepare(
    'SELECT COUNT(*) as count FROM rate_limits WHERE ip = ? AND endpoint = ? AND timestamp > ?'
  ).bind(ip, endpoint, windowStart).first();
  if ((row?.count ?? 0) >= limit) return false;
  await db.prepare('INSERT INTO rate_limits (ip, endpoint, timestamp) VALUES (?, ?, ?)').bind(ip, endpoint, now).run();
  return true;
}

// Convenience: returns a 429 Response if limited, otherwise null. Fails open on DB error (logged).
export async function rateLimitOr429(env, request, endpoint, limit, windowSeconds = 3600) {
  if (!env.DB) return null;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  try {
    if (!await checkRateLimit(env.DB, ip, endpoint, limit, windowSeconds)) {
      return json({ error: 'Too many requests. Please try again later.' }, 429);
    }
  } catch (err) {
    console.error(`Rate limit check failed (${endpoint}):`, err);
  }
  return null;
}

// ── HMAC tokens (used for portal magic links / unsubscribe) ────────────────

function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

// token = b64url(payload).b64url(sig); payload = JSON {p: purpose, e: email, x: expiresUnix}
export async function signToken(secret, purpose, email, ttlSeconds) {
  const payload = new TextEncoder().encode(JSON.stringify({ p: purpose, e: email, x: Math.floor(Date.now() / 1000) + ttlSeconds }));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), payload));
  return `${b64url(payload)}.${b64url(sig)}`;
}

// Returns email on success, null on any failure.
export async function verifyToken(secret, purpose, token) {
  try {
    const [p, s] = String(token).split('.');
    if (!p || !s) return null;
    const payload = unb64url(p);
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), unb64url(s), payload);
    if (!ok) return null;
    const data = JSON.parse(new TextDecoder().decode(payload));
    if (data.p !== purpose || typeof data.e !== 'string') return null;
    if (data.x < Math.floor(Date.now() / 1000)) return null;
    return data.e;
  } catch {
    return null;
  }
}
