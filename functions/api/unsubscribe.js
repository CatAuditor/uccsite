// GET/POST /api/unsubscribe?token=...
// Token is an HMAC-signed (TOKEN_SECRET) email + expiry issued by subscribe.js.
// POST supports RFC 8058 one-click unsubscribe from mail clients.

import { verifyToken } from './_lib.js';

async function handle({ request, env }) {
  const token = new URL(request.url).searchParams.get('token');
  const email = env.TOKEN_SECRET ? await verifyToken(env.TOKEN_SECRET, 'unsubscribe', token) : null;

  if (!email) return page('This unsubscribe link is invalid or has expired.', 400);

  try {
    await env.DB.prepare('DELETE FROM subscribers WHERE email = ?').bind(email).run();
    await env.DB.prepare('UPDATE members SET newsletter_opt_in = 0 WHERE email = ?').bind(email).run();
  } catch (err) {
    console.error('unsubscribe DB error:', err);
    return page('Something went wrong. Please email info@utahciviccompact.org.', 500);
  }

  return page("You've been unsubscribed. Sorry to see you go.");
}

export const onRequestGet = handle;
export const onRequestPost = handle;

function page(message, status = 200) {
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Unsubscribe | Utah Civic Compact</title>
<style>body{font-family:Georgia,serif;background:#f5f5f0;color:#2c2c2c;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}main{background:#fff;padding:40px;border-radius:8px;max-width:480px;text-align:center}a{color:#1a3a2a}</style></head>
<body><main><p>${message}</p><p><a href="/">utahciviccompact.org</a></p></main></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
