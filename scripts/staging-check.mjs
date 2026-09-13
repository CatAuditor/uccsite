#!/usr/bin/env node
// staging-check.mjs — end-to-end verification of a deployed distribution:
// exercises every CloudFront Function path (auth gate, clean URLs, 308s,
// redirect map, 404), the response-header policies, the admin behaviors, and
// /api/health (origin lock + DSQL reachability). Run after every infra deploy.
//
// Usage: node scripts/staging-check.mjs [--base https://dxxxx.cloudfront.net] [--auth user:pass]
//   --auth '' skips the basic-auth expectation (prod).

const args = process.argv.slice(2);
function argVal(name, def) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : def;
}
const BASE = argVal('--base', 'https://d3heb9s058a59m.cloudfront.net').replace(/\/$/, '');
const AUTH_CRED = argVal('--auth', 'preview:wasatch-front-2026');
const AUTH = AUTH_CRED ? 'Basic ' + Buffer.from(AUTH_CRED).toString('base64') : '';

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  ok ? pass++ : fail++;
}

async function get(path, opts = {}) {
  const headers = { ...(AUTH ? { authorization: AUTH } : {}), ...(opts.headers || {}) };
  return fetch(BASE + path, { redirect: 'manual', ...opts, headers });
}

if (AUTH) {
  const r0 = await fetch(BASE + '/', { redirect: 'manual' });
  check('no-auth request gets 401', r0.status === 401, String(r0.status));
}

let r = await get('/alpr');
check('/alpr serves 200 html', r.status === 200 && (r.headers.get('content-type') || '').includes('text/html'), String(r.status));

r = await get('/alpr.html');
check('/alpr.html 308 -> /alpr', r.status === 308 && r.headers.get('location') === '/alpr', `${r.status} ${r.headers.get('location')}`);

r = await get('/');
check('/ serves 200', r.status === 200, String(r.status));

r = await get('/index.html');
check('/index.html 308 -> /', r.status === 308 && r.headers.get('location') === '/', `${r.status} ${r.headers.get('location')}`);

r = await get('/alpr/');
check('/alpr/ 308 -> /alpr', r.status === 308 && r.headers.get('location') === '/alpr', `${r.status} ${r.headers.get('location')}`);

r = await get('/definitely-not-a-page');
const notFoundBody = await r.text();
check('unknown path returns 404 status', r.status === 404, String(r.status));
check('404 body is the 404 page', notFoundBody.includes('Page Not Found'));

r = await get('/auth');
check('/auth 302 via redirect map', r.status === 302 && (r.headers.get('location') || '').includes('uccsite-auth.cothv.workers.dev'), `${r.status} ${r.headers.get('location')}`);

r = await get('/team');
const h = (n) => r.headers.get(n) || '';
check('HSTS present', h('strict-transport-security').includes('preload'));
check('X-Frame-Options DENY', h('x-frame-options') === 'DENY');
check('nosniff', h('x-content-type-options') === 'nosniff');
check('Referrer-Policy', h('referrer-policy') === 'strict-origin-when-cross-origin');
check('Permissions-Policy', h('permissions-policy').includes('camera=()'));
const csp = h('content-security-policy');
check('CSP present, script-src self only', csp.includes("script-src 'self'") && !csp.includes('cloudflareinsights'));
check('CSP frame-ancestors none', csp.includes("frame-ancestors 'none'"));
if (AUTH) check('staging noindex header', h('x-robots-tag').includes('noindex'));

r = await get('/admin');
check('/admin serves 200', r.status === 200, String(r.status));
const adminCsp = r.headers.get('content-security-policy') || '';
check('admin CSP allows unsafe-eval + github', adminCsp.includes("'unsafe-eval'") && adminCsp.includes('api.github.com'));
check('admin no-store', (r.headers.get('cache-control') || '').includes('no-store'));

// A page whose slug merely STARTS with "admin" must get the SITE policy.
r = await get('/administration-nonexistent');
const adminishCsp = r.headers.get('content-security-policy') || '';
check('/admin-prefixed non-admin path gets site CSP', !adminishCsp.includes("'unsafe-eval'"));

r = await get('/css/styles.css');
check('/css/styles.css 200', r.status === 200, String(r.status));
r = await get('/sitemap.xml');
const sitemapBody = r.status === 200 ? await r.text() : '';
check('/sitemap.xml 200 with clean locs', r.status === 200 && sitemapBody.includes('<loc>https://utahciviccompact.org/alpr</loc>'));

r = await get('/api/health');
let apiBody = {};
try { apiBody = await r.json(); } catch {}
check('/api/health 200 db ok', r.status === 200 && apiBody.db === 'ok', `${r.status} ${JSON.stringify(apiBody)}`);
check('api no-store', (r.headers.get('cache-control') || '').includes('no-store'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
