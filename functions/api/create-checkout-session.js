const MIN_AMOUNT_CENTS = 100;
const MAX_AMOUNT_CENTS = 10_000_000; // $100k sanity ceiling

export async function onRequestPost({ request, env }) {
  try {
    const { type, amountCents, email, firstName, lastName, zip, newsletterOptIn, publicDonor } = await request.json();

    if (!['subscription', 'onetime'].includes(type)) {
      return json({ error: 'Invalid type' }, 400);
    }

    const cents = parseInt(amountCents, 10);
    if (!cents || cents < MIN_AMOUNT_CENTS || cents > MAX_AMOUNT_CENTS) {
      return json({ error: 'Invalid amount' }, 400);
    }

    const origin = new URL(request.url).origin;

    const priceData = {
      currency: 'usd',
      unit_amount: cents,
      product_data: {
        name: type === 'subscription' ? 'Monthly Membership — Utah Civic Compact' : 'Donation — Utah Civic Compact',
      },
    };

    if (type === 'subscription') {
      priceData.recurring = { interval: 'month' };
    }

    const sessionParams = {
      mode: type === 'subscription' ? 'subscription' : 'payment',
      line_items: [{ price_data: priceData, quantity: 1 }],
      success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/#donate`,
      metadata: {
        firstName: firstName || '',
        lastName: lastName || '',
        zip: zip || '',
        newsletterOptIn: newsletterOptIn ? '1' : '0',
        publicDonor: publicDonor === false ? '0' : '1',
      },
    };

    if (email) sessionParams.customer_email = email;

    const session = await stripePost(env.STRIPE_SECRET_KEY, 'checkout/sessions', sessionParams);

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
