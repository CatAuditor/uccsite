// API Lambda entrypoint (build-spec-aws.md §10): one function behind a
// Function URL, routed at /api/* through CloudFront. Port of functions/api/;
// this file replaces the Pages routing layer and _middleware.js.
//
// Security layers, in order:
//   1. origin lock — requests must carry the x-origin-verify header CloudFront
//      stamps (a direct Function URL hit gets 403)
//   2. per-route rate limits + Turnstile (in routes.js)
//   3. response headers stamped exactly as _middleware.js did: nosniff,
//      Referrer-Policy, X-Robots-Tag: noindex, Cache-Control no-store unless
//      the route set its own
import { Buffer } from 'node:buffer';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { makeCachedClient } from '@uccsite/db';
import { loadSecrets } from './secrets.js';
import { handleWebhook } from './webhook.js';
import {
  subscribe, unsubscribe, tip, createCheckoutSession,
  createPortalSessionPost, createPortalSessionGet, portalLinkJob, donationStats,
} from './routes.js';

const { DSQL_ENDPOINT, ORIGIN_VERIFY_SECRET, PUBLIC_ORIGIN } = process.env;
const region = process.env.AWS_REGION;

const db = makeCachedClient({ endpoint: DSQL_ENDPOINT, region });
const lambda = new LambdaClient({ region });

// Fire-and-forget async self-invocation (the portal magic-link job). The
// payload shape is constant for every accepted request — timing-safe 202.
async function selfInvoke(payload) {
  await lambda.send(new InvokeCommand({
    FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
    InvocationType: 'Event',
    Payload: Buffer.from(JSON.stringify(payload)),
  }));
}

// _middleware.js parity: stamp API headers, Cache-Control only if unset.
function stampHeaders(res) {
  const headers = { ...res.headers };
  headers['X-Content-Type-Options'] = 'nosniff';
  headers['Referrer-Policy'] = 'strict-origin-when-cross-origin';
  headers['X-Robots-Tag'] = 'noindex';
  if (!('Cache-Control' in headers) && !('cache-control' in headers)) {
    headers['Cache-Control'] = 'no-store';
  }
  return { ...res, headers };
}

export async function handler(event) {
  // Internal job dispatch: only direct Invoke events land here — a Function
  // URL request ALWAYS carries requestContext.http, so this path is
  // unreachable from the internet.
  if (!event.requestContext?.http) {
    if (event.job === 'portal-link') {
      const secrets = await loadSecrets();
      await portalLinkJob({ db, secrets, email: event.email, origin: event.origin });
    }
    return { ok: true };
  }

  // Origin lock.
  if (!ORIGIN_VERIFY_SECRET || event.headers?.['x-origin-verify'] !== ORIGIN_VERIFY_SECRET) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  const method = event.requestContext.http.method;
  const path = event.requestContext.http.path;
  const secrets = await loadSecrets();

  // The site's public origin (links in emails, Stripe redirect URLs). The
  // Host header CloudFront forwards is the Function URL's own, so the origin
  // comes from config.
  const origin = PUBLIC_ORIGIN || `https://${event.headers?.host}`;

  // Raw body FIRST, exactly as received — the webhook HMAC covers these bytes.
  const rawBody = event.body === undefined ? '' :
    (event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body);

  // JSON body (undefined = malformed → routes return their original 400s).
  let body;
  if (method === 'POST' && path !== '/api/webhook') {
    try { body = JSON.parse(rawBody); } catch { body = undefined; }
    if (body !== undefined && (typeof body !== 'object' || body === null)) body = undefined;
  }

  const ctx = { event, db, secrets, body, origin, rawBody, selfInvoke };

  let res;
  if (path === '/api/webhook' && method === 'POST') res = await handleWebhook(ctx);
  else if (path === '/api/subscribe' && method === 'POST') res = await subscribe(ctx);
  else if (path === '/api/unsubscribe' && (method === 'GET' || method === 'POST')) res = await unsubscribe(ctx);
  else if (path === '/api/tip' && method === 'POST') res = await tip(ctx);
  else if (path === '/api/create-checkout-session' && method === 'POST') res = await createCheckoutSession(ctx);
  else if (path === '/api/create-portal-session' && method === 'POST') res = await createPortalSessionPost(ctx);
  else if (path === '/api/create-portal-session' && method === 'GET') res = await createPortalSessionGet(ctx);
  else if (path === '/api/donations/stats' && method === 'GET') res = await donationStats(ctx);
  else if (path === '/api/health' && method === 'GET') res = await health();
  else res = { statusCode: 404, headers: {}, body: JSON.stringify({ error: 'Not found' }) };

  return stampHeaders(res);
}

async function health() {
  try {
    const r = await db.query('SELECT 1 AS ok');
    return {
      statusCode: r.rows[0].ok === 1 ? 200 : 503,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ db: r.rows[0].ok === 1 ? 'ok' : 'unexpected' }),
    };
  } catch (err) {
    console.error('[api] health db check failed:', err.message);
    return { statusCode: 503, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ db: 'unreachable' }) };
  }
}
