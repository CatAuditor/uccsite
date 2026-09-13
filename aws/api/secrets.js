'use strict';
// Runtime secret loading. Values are fetched from Secrets Manager at cold
// start and cached — never baked into the CloudFormation template or Lambda
// env (rotation needs no redeploy). A secret still holding its CDK-created
// placeholder counts as UNSET so routes degrade exactly as the Cloudflare
// stack did with a missing secret (portal 503s, unsubscribe link falls back).
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const PLACEHOLDER = 'REPLACE_ME';
const NAMES = [
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'AIRTABLE_TOKEN',
  'RESEND_API_KEY', 'TOKEN_SECRET', 'TURNSTILE_SECRET_KEY',
];

// Per-secret cache. A FAILED fetch is never cached — a transient Secrets
// Manager throttle at cold start must not poison a warm container for its
// whole life (a container stuck without STRIPE_WEBHOOK_SECRET would 401
// every Stripe delivery for hours). Placeholder/unset results ARE cached:
// they're a stable configuration state, not an error.
const cache = new Map(); // name -> value | null (null = confirmed unset)
let client = null;

// loadSecrets() → { NAME: value | undefined, ... }
// Env var SECRET_ARN_<NAME> carries each secret's ARN (set by CDK).
async function loadSecrets() {
  client ??= new SecretsManagerClient({});
  await Promise.all(NAMES.map(async (name) => {
    if (cache.has(name)) return;
    const arn = process.env[`SECRET_ARN_${name}`];
    if (!arn) { cache.set(name, null); return; }
    try {
      const res = await client.send(new GetSecretValueCommand({ SecretId: arn }));
      const value = res.SecretString;
      if (value && value !== PLACEHOLDER) cache.set(name, value);
      else { cache.set(name, null); console.warn(`[api] secret ${name} is unset (placeholder)`); }
    } catch (err) {
      // NOT cached — retried on the next invocation.
      console.error(`[api] failed to load secret ${name}: ${err.name}`);
    }
  }));
  const out = {};
  for (const name of NAMES) {
    const v = cache.get(name);
    if (v) out[name] = v;
  }
  return out;
}

module.exports = { loadSecrets, PLACEHOLDER, NAMES };
