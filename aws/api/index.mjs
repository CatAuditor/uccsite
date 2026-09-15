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
  createPortalSessionPost, createPortalSessionGet, portalLinkJob, welcomeEmailJob, donationStats,
} from './routes.js';

const { DSQL_ENDPOINT, ORIGIN_VERIFY_SECRET, PUBLIC_ORIGIN } = process.env;
// Least-privilege database role (packages/db/schema.js API_ROLE); the stack
// sets it and grants dsql:DbConnect (not DbConnectAdmin) — see api-security.md.
const DSQL_USER = process.env.DSQL_USER || 'api';
const region = process.env.AWS_REGION;

const db = makeCachedClient({ endpoint: DSQL_ENDPOINT, region, user: DSQL_USER });
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

// Route table, keyed `${method} ${path}`. Per-route flags live beside the
// handler so the shared middle needs no route-specific ifs:
//   rawBody: handler consumes the exact received bytes (HMAC) — never JSON-parse
//   secrets: route reads third-party secrets (skipped for health/stats so a
//            Secrets Manager fetch never blocks them)
const ROUTES = {
  'POST /api/webhook': { fn: handleWebhook, rawBody: true, secrets: true },
  'POST /api/subscribe': { fn: subscribe, secrets: true },
  'GET /api/unsubscribe': { fn: unsubscribe, secrets: true },
  'POST /api/unsubscribe': { fn: unsubscribe, secrets: true },
  'POST /api/tip': { fn: tip, secrets: true },
  'POST /api/create-checkout-session': { fn: createCheckoutSession, secrets: true },
  'POST /api/create-portal-session': { fn: createPortalSessionPost, secrets: true },
  'GET /api/create-portal-session': { fn: createPortalSessionGet, secrets: true },
  'GET /api/donations/stats': { fn: donationStats },
  'GET /api/health': { fn: health },
};

const JOBS = {
  'portal-link': (event, secrets) => portalLinkJob({ db, secrets, email: event.email, origin: event.origin }),
  'welcome-email': (event, secrets) => welcomeEmailJob({ secrets, email: event.email, firstName: event.firstName, origin: event.origin }),
};

export async function handler(event) {
  // Internal job dispatch: only direct Invoke events land here — a Function
  // URL request ALWAYS carries requestContext.http, so this path is
  // unreachable from the internet.
  if (!event.requestContext?.http) {
    const job = JOBS[event.job];
    if (job) await job(event, await loadSecrets());
    return { ok: true };
  }

  // Origin lock.
  if (!ORIGIN_VERIFY_SECRET || event.headers?.['x-origin-verify'] !== ORIGIN_VERIFY_SECRET) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  const method = event.requestContext.http.method;
  const path = event.requestContext.http.path;
  const route = ROUTES[`${method} ${path}`];
  if (!route) {
    return stampHeaders({ statusCode: 404, headers: {}, body: JSON.stringify({ error: 'Not found' }) });
  }

  const secrets = route.secrets ? await loadSecrets() : {};

  // The site's public origin (links in emails, Stripe redirect URLs). Config
  // only — the forwarded Host is the Function URL's own domain, and links
  // pointing there would 403 on the origin lock. CDK refuses to synth an env
  // without it.
  if (!PUBLIC_ORIGIN) console.error('[api] PUBLIC_ORIGIN is not set — email links and Stripe redirects will be wrong');
  const origin = PUBLIC_ORIGIN || 'https://utahciviccompact.org';

  // Raw body exactly as received — the webhook HMAC covers these bytes.
  const rawBody = event.body === undefined ? '' :
    (event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body);

  // JSON body for non-raw POST routes (undefined = malformed → routes 400).
  let body;
  if (method === 'POST' && !route.rawBody) {
    try { body = JSON.parse(rawBody); } catch { body = undefined; }
    if (body !== undefined && (typeof body !== 'object' || body === null)) body = undefined;
  }

  const res = await route.fn({ event, db, secrets, body, origin, rawBody, selfInvoke });
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
