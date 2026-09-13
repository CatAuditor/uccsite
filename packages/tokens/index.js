'use strict';
// THE HMAC token implementation, shared by aws/api and
// scripts/send-periodical.js. Byte-identical to functions/api/_lib.js (the
// live Cloudflare stack) — the cross-verification test in aws/api/test pins
// it. Tokens: b64url(payload).b64url(sig); payload JSON {p, e, x}.
// Do not change the payload shape: every unsubscribe link already sent is a
// 1-year credential signed in this exact format.

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

async function signToken(secret, purpose, email, ttlSeconds) {
  const payload = new TextEncoder().encode(JSON.stringify({ p: purpose, e: email, x: Math.floor(Date.now() / 1000) + ttlSeconds }));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), payload));
  return `${b64url(payload)}.${b64url(sig)}`;
}

// Returns email on success, null on any failure.
async function verifyToken(secret, purpose, token) {
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

module.exports = { signToken, verifyToken };
