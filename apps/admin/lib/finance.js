// Financial → Costs data (docs/systems/finance.md): what the site costs to
// run, pulled live from the two places money moves —
//   AWS   Cost Explorer GetCostAndUsage, monthly by service, as billed
//         (needs ce:GetCostAndUsage on the admin's role; each call is a
//         paid API request, so one fetch is kept for CE_TTL per process).
//   Stripe balance + balance transactions for the same months (gross,
//         refunds, fees, net, paid out). The secret key is read once from
//         Secrets Manager (ucc/<env>/STRIPE_SECRET_KEY, the API Lambda's
//         own secret; needs secretsmanager:GetSecretValue on it) and never
//         leaves this module. A placeholder / missing key → "not connected".
// Every fetch degrades to { error } instead of throwing: the page renders
// whatever it could get and says what it could not.
import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { config } from './config';
import { lastMonths, shapeAwsCosts, shapeStripeMonths, sumCents } from './finance-shape.mjs';
export { lastMonths, monthKey, monthLabel } from './finance-shape.mjs';

const CE_TTL = 60 * 60 * 1000;      // Cost Explorer: $0.01 per request
const STRIPE_TTL = 10 * 60 * 1000;
const PLACEHOLDER = 'REPLACE_ME';   // the CDK-created value before the real key is filled in
const STRIPE_API_VERSION = '2024-06-20';   // aws/api/lib.js — same pin as the API Lambda

// ── AWS ─────────────────────────────────────────────────────────────────────
let ceCache = null; // { at, months, value }

// awsCosts(months) → { months: ['2026-05', …], services: [{ name, byMonth: {key: usd}, total }],
//                      totals: {key: usd}, fetchedAt } | { error }
export async function awsCosts(months = 6) {
  if (ceCache && ceCache.months === months && Date.now() - ceCache.at < CE_TTL) return ceCache.value;
  const keys = lastMonths(months);
  const start = `${keys[0]}-01`;
  const now = new Date();
  // End is exclusive; tomorrow (UTC) includes today's partial data.
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString().slice(0, 10);
  try {
    // Cost Explorer is a global (us-east-1) API.
    const res = await new CostExplorerClient({ region: 'us-east-1' }).send(new GetCostAndUsageCommand({
      TimePeriod: { Start: start, End: end },
      Granularity: 'MONTHLY',
      Metrics: ['UnblendedCost'],
      GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
    }));
    const value = shapeAwsCosts(res.ResultsByTime || [], keys);
    ceCache = { at: Date.now(), months, value };
    console.log(`[finance] aws costs: ${value.services.length} services over ${keys.length} months, this month $${(value.totals[keys[keys.length - 1]] || 0).toFixed(2)}`);
    return value;
  } catch (err) {
    console.error(`[finance] aws costs failed: ${err.name}: ${err.message}`);
    return { error: friendlyAws(err) };
  }
}

function friendlyAws(err) {
  if (err.name === 'AccessDeniedException') return 'The admin’s AWS role is not allowed to read Cost Explorer yet (ce:GetCostAndUsage — see docs/for-conner.md §15).';
  if (err.name === 'DataUnavailableException') return 'Cost Explorer has not finished preparing this account’s data (it takes up to 24 hours after it is first opened in the AWS console).';
  return `AWS Cost Explorer: ${err.message || err.name}`;
}

// ── Stripe ──────────────────────────────────────────────────────────────────
let stripeKey; // undefined = not fetched yet; null = confirmed unset
let stripeCache = null;

async function loadStripeKey() {
  if (stripeKey !== undefined) return stripeKey;
  const name = process.env.STRIPE_SECRET_NAME || `ucc/${config.envName}/STRIPE_SECRET_KEY`;
  const res = await new SecretsManagerClient({ region: config.region }).send(new GetSecretValueCommand({ SecretId: name }));
  const v = res.SecretString;
  stripeKey = v && v !== PLACEHOLDER ? v : null;
  if (!stripeKey) console.warn(`[finance] stripe key ${name} is unset (placeholder)`);
  return stripeKey;
}

async function stripeGet(key, path, query = {}) {
  const url = new URL(`https://api.stripe.com/v1/${path}`);
  for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}`, 'Stripe-Version': STRIPE_API_VERSION } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Stripe ${res.status}`);
  return data;
}

// stripeSummary(months) → { livemode, balance: { available, pending } (cents),
//   months: [key…], byMonth: { key: { gross, refunds, fees, net, payouts, count } }, fetchedAt } | { error, unset? }
export async function stripeSummary(months = 6) {
  if (stripeCache && stripeCache.months === months && Date.now() - stripeCache.at < STRIPE_TTL) return stripeCache.value;
  let key;
  try {
    key = await loadStripeKey();
  } catch (err) {
    console.error(`[finance] stripe key read failed: ${err.name}: ${err.message}`);
    return { error: err.name === 'AccessDeniedException'
      ? 'The admin’s AWS role may not read the Stripe key yet (secretsmanager:GetSecretValue — see docs/for-conner.md §15).'
      : `Stripe key: ${err.message}` };
  }
  if (!key) return { error: 'Stripe is not connected: the STRIPE_SECRET_KEY secret still holds its placeholder.', unset: true };
  const keys = lastMonths(months);
  const since = Math.floor(Date.UTC(Number(keys[0].slice(0, 4)), Number(keys[0].slice(5)) - 1, 1) / 1000);
  try {
    const balance = await stripeGet(key, 'balance');
    const txns = [];
    let starting_after;
    for (let page = 0; page < 20; page++) {           // 2,000 transactions at most
      const res = await stripeGet(key, 'balance_transactions', { limit: 100, 'created[gte]': since, starting_after });
      txns.push(...res.data);
      if (!res.has_more || !res.data.length) break;
      starting_after = res.data[res.data.length - 1].id;
    }
    const value = {
      livemode: !!balance.livemode,
      balance: {
        available: sumCents(balance.available), pending: sumCents(balance.pending),
      },
      months: keys,
      byMonth: shapeStripeMonths(txns, keys),
      fetchedAt: new Date().toISOString(),
    };
    stripeCache = { at: Date.now(), months, value };
    console.log(`[finance] stripe: ${txns.length} balance transactions since ${keys[0]}, ${value.livemode ? 'live' : 'TEST'} mode`);
    return value;
  } catch (err) {
    console.error(`[finance] stripe fetch failed: ${err.message}`);
    return { error: `Stripe: ${err.message}` };
  }
}
