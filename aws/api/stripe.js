'use strict';
// Hand-rolled Stripe HTTP helpers, ported verbatim from
// functions/api/create-checkout-session.js. No SDK, version pinned (spec §10).
const { STRIPE_API_VERSION } = require('./lib');

class StripeError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function stripePost(secretKey, endpoint, params) {
  const res = await fetch(`https://api.stripe.com/v1/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': STRIPE_API_VERSION,
    },
    body: toFormData(params),
  });
  const data = await res.json();
  if (!res.ok) throw new StripeError(data.error?.message || 'Stripe error', res.status);
  return data;
}

function toFormData(obj, prefix = '') {
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      parts.push(toFormData(v, key));
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === 'object') {
          parts.push(toFormData(item, `${key}[${i}]`));
        } else {
          parts.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(item)}`);
        }
      });
    } else if (v !== undefined && v !== null) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
    }
  }
  return parts.join('&');
}

module.exports = { StripeError, stripePost, toFormData };
