export async function onRequestPost({ request, env }) {
  try {
    const { email } = await request.json();

    if (!email || typeof email !== 'string') {
      return json({ error: 'Missing email' }, 400);
    }

    const member = await env.DB.prepare(
      'SELECT stripe_customer_id FROM members WHERE email = ?'
    ).bind(email.trim().toLowerCase()).first();

    if (!member?.stripe_customer_id) {
      return json({ error: 'No account found for that email' }, 404);
    }

    const origin = new URL(request.url).origin;

    const res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        customer: member.stripe_customer_id,
        return_url: `${origin}/#donate`,
      }),
    });

    const session = await res.json();
    if (!res.ok) return json({ error: session.error?.message || 'Stripe error' }, 500);

    return json({ url: session.url });
  } catch (err) {
    console.error('create-portal-session error:', err);
    return json({ error: 'Internal error' }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
