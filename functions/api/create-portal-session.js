export async function onRequestPost({ request, env }) {
  try {
    const { customerId } = await request.json();

    if (!customerId || typeof customerId !== 'string') {
      return json({ error: 'Missing customerId' }, 400);
    }

    const origin = new URL(request.url).origin;

    const res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        customer: customerId,
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
