const ALLOWED_PRICE_IDS = new Set([
  'price_1TUYkERpmK1SjHcTTLQtmoma', // $5/month
  'price_1TUYkERpmK1SjHcTVIVSLS2f', // $10/month
  'price_1TUYkERpmK1SjHcT1coNdzwN', // $25/month
  'price_1TUYkFRpmK1SjHcTh7g0nWcf', // $50/month
]);

const ONE_TIME_PRODUCT_ID = 'prod_UTVm4cVYMIA6rf';
const SUBSCRIPTION_PRODUCT_ID = 'prod_UTVky5gwtrIM9A';
const MIN_AMOUNT_CENTS = 100;
const MAX_AMOUNT_CENTS = 10_000_000; // $100k sanity ceiling

export async function onRequestPost({ request, env }) {
  try {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (env.DB && !await checkRateLimit(env.DB, ip, 'checkout', 10, 3600)) {
      return json({ error: 'Too many requests. Please try again later.' }, 429);
    }

    const { type, priceId, amountCents, email, firstName, lastName, zip, newsletterOptIn } = await request.json();

    if (!['subscription', 'onetime'].includes(type)) {
      return json({ error: 'Invalid type' }, 400);
    }

    const origin = new URL(request.url).origin;
    let sessionParams;

    if (type === 'subscription') {
      let lineItem;

      if (priceId) {
        if (!ALLOWED_PRICE_IDS.has(priceId)) {
          return json({ error: 'Invalid price' }, 400);
        }
        lineItem = { price: priceId, quantity: 1 };
      } else {
        // Custom amount monthly
        const cents = parseInt(amountCents, 10);
        if (!cents || cents < MIN_AMOUNT_CENTS || cents > MAX_AMOUNT_CENTS) {
          return json({ error: 'Invalid amount' }, 400);
        }
        lineItem = {
          price_data: {
            currency: 'usd',
            product: SUBSCRIPTION_PRODUCT_ID,
            unit_amount: cents,
            recurring: { interval: 'month' },
          },
          quantity: 1,
        };
      }

      sessionParams = {
        mode: 'subscription',
        line_items: [lineItem],
      };
    } else {
      const cents = parseInt(amountCents, 10);
      if (!cents || cents < MIN_AMOUNT_CENTS || cents > MAX_AMOUNT_CENTS) {
        return json({ error: 'Invalid amount' }, 400);
      }
      sessionParams = {
        mode: 'payment',
        line_items: [{
          price_data: {
            currency: 'usd',
            product: ONE_TIME_PRODUCT_ID,
            unit_amount: cents,
          },
          quantity: 1,
        }],
      };
    }

    if (email) sessionParams.customer_email = email;
    sessionParams.success_url = `${origin}/success?session_id={CHECKOUT_SESSION_ID}`;
    sessionParams.cancel_url = `${origin}/#donate`;
    sessionParams.metadata = { firstName: firstName || '', lastName: lastName || '', zip: zip || '', newsletterOptIn: newsletterOptIn ? '1' : '0' };

    const session = await stripePost(env.STRIPE_SECRET_KEY, 'checkout/sessions', sessionParams);

    // Upsert member into D1 if we have an email
    if (email && env.DB) {
      await env.DB.prepare(
        `INSERT INTO members (stripe_customer_id, email, first_name, last_name, zip, newsletter_opt_in)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(stripe_customer_id) DO NOTHING`
      ).bind(session.customer || 'pending_' + session.id, email, firstName || null, lastName || null, zip || null, newsletterOptIn ? 1 : 0).run();
    }

    return json({ url: session.url });
  } catch (err) {
    console.error('create-checkout-session error:', err);
    return json({ error: 'Internal error' }, 500);
  }
}

async function stripePost(secretKey, endpoint, params) {
  const body = toFormData(params);
  const res = await fetch(`https://api.stripe.com/v1/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Stripe error');
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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function checkRateLimit(db, ip, endpoint, limit, windowSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - windowSeconds;
  await db.prepare('DELETE FROM rate_limits WHERE timestamp < ?').bind(windowStart).run();
  const row = await db.prepare(
    'SELECT COUNT(*) as count FROM rate_limits WHERE ip = ? AND endpoint = ? AND timestamp > ?'
  ).bind(ip, endpoint, windowStart).first();
  if ((row?.count ?? 0) >= limit) return false;
  await db.prepare('INSERT INTO rate_limits (ip, endpoint, timestamp) VALUES (?, ?, ?)').bind(ip, endpoint, now).run();
  return true;
}
