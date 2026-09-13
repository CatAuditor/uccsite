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

let cached = null;

// loadSecrets() → { NAME: value | undefined, ... }
// Env var SECRET_ARN_<NAME> carries each secret's ARN (set by CDK).
async function loadSecrets() {
  if (cached) return cached;
  const client = new SecretsManagerClient({});
  const out = {};
  await Promise.all(NAMES.map(async (name) => {
    const arn = process.env[`SECRET_ARN_${name}`];
    if (!arn) return;
    try {
      const res = await client.send(new GetSecretValueCommand({ SecretId: arn }));
      const value = res.SecretString;
      if (value && value !== PLACEHOLDER) out[name] = value;
      else console.warn(`[api] secret ${name} is unset (placeholder)`);
    } catch (err) {
      console.error(`[api] failed to load secret ${name}: ${err.name}`);
    }
  }));
  cached = out;
  return cached;
}

module.exports = { loadSecrets, PLACEHOLDER, NAMES };
