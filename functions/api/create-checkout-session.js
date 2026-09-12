import { json, isValidEmail, str, rateLimitOr429, STRIPE_API_VERSION } from './_lib.js';

const MIN_AMOUNT_CENTS = 100;
const MAX_AMOUNT_CENTS = 10_000_000; // $100k sanity ceiling

export async function onRequestPost({ request, env }) {
  const limited = await rateLimitOr429(env, request, 'checkout', 10);
  if (limited) return limited;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  const { type, amountCents, newsletterOptIn, publicDonor } = body;
  const email = str(body.email, 254).toLowerCase();
  const firstName = str(body.firstName, 100);
  const lastName = str(body.lastName, 100);
  const zip = str(body.zip, 10);

  if (!['subscription', 'onetime'].includes(type)) {
    return json({ error: 'Invalid type' }, 400);
  }

  const cents = parseInt(amountCents, 10);
  if (!cents || cents < MIN_AMOUNT_CENTS || cents > MAX_AMOUNT_CENTS) {
    return json({ error: 'Invalid amount' }, 400);
  }

  if (email && !isValidEmail(email)) {
    return json({ error: 'Invalid email address' }, 400);
  }

  try {
    const origin = new URL(request.url).origin;
    const isSub = type === 'subscription';

    const priceData = {
      currency: 'usd',
      unit_amount: cents,
      product_data: {
        name: isSub ? 'Monthly Membership — Utah Civic Compact' : 'Donation — Utah Civic Compact',
      },
    };
    if (isSub) priceData.recurring = { interval: 'month' };

    const metadata = {
      firstName,
      lastName,
      zip,
      newsletterOptIn: newsletterOptIn ? '1' : '0',
      publicDonor: publicDonor === false ? '0' : '1',
    };

    const sessionParams = {
      mode: isSub ? 'subscription' : 'payment',
      line_items: [{ price_data: priceData, quantity: 1 }],
      success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/#donate`,
      metadata,
    };

    if (isSub) {
      // Carry donor prefs onto the subscription so invoice.paid can honor them.
      sessionParams.subscription_data = { metadata };
    } else {
      // Always create a Customer so the webhook can link the donation to a member.
      sessionParams.customer_creation = 'always';
    }

    if (email) sessionParams.customer_email = email;

    const session = await stripePost(env.STRIPE_SECRET_KEY, 'checkout/sessions', sessionParams);
    return json({ url: session.url });
  } catch (err) {
    if (err instanceof StripeError && err.status < 500) {
      return json({ error: err.message }, 400);
    }
    console.error('create-checkout-session error:', err);
    return json({ error: 'Internal error' }, 500);
  }
}

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
