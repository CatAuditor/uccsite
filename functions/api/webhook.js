export async function onRequestPost({ request, env }) {
  const sig = request.headers.get('stripe-signature');
  const rawBody = await request.text();

  let event;
  try {
    event = await verifyStripeSignature(rawBody, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutComplete(event.data.object, env.DB);
        break;
      case 'invoice.paid':
        await handleInvoicePaid(event.data.object, env.DB);
        break;
      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object, env.DB);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object, env.DB);
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object, env.DB);
        break;
    }
  } catch (err) {
    console.error(`Handler error for ${event.type}:`, err);
    return new Response('Handler error', { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handleCheckoutComplete(session, db) {
  const customerId = session.customer;
  const email = session.customer_email || session.customer_details?.email;
  const { firstName, lastName, zip, newsletterOptIn } = session.metadata || {};

  if (email && customerId) {
    const optIn = newsletterOptIn === '1' ? 1 : 0;
    await db.prepare(
      `INSERT INTO members (stripe_customer_id, email, first_name, last_name, zip, newsletter_opt_in)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(stripe_customer_id) DO UPDATE SET
         email = excluded.email,
         first_name = COALESCE(excluded.first_name, first_name),
         last_name = COALESCE(excluded.last_name, last_name),
         zip = COALESCE(excluded.zip, zip),
         newsletter_opt_in = excluded.newsletter_opt_in`
    ).bind(customerId, email, firstName || null, lastName || null, zip || null, optIn).run();
  }

  if (session.mode === 'payment' && session.payment_intent) {
    const member = await getMemberByStripeId(db, customerId);
    if (member) {
      await db.prepare(
        `INSERT INTO donations (member_id, stripe_payment_intent_id, amount_cents)
         VALUES (?, ?, ?)
         ON CONFLICT(stripe_payment_intent_id) DO NOTHING`
      ).bind(member.id, session.payment_intent, session.amount_total).run();
    }
  }
}

async function handleInvoicePaid(invoice, db) {
  const subscriptionId = invoice.subscription;
  if (!subscriptionId) return;

  await db.prepare(
    `UPDATE subscriptions SET status = 'active', updated_at = datetime('now')
     WHERE stripe_subscription_id = ?`
  ).bind(subscriptionId).run();
}

async function handlePaymentFailed(invoice, db) {
  const subscriptionId = invoice.subscription;
  if (!subscriptionId) return;

  await db.prepare(
    `UPDATE subscriptions SET status = 'past_due', updated_at = datetime('now')
     WHERE stripe_subscription_id = ?`
  ).bind(subscriptionId).run();
}

async function handleSubscriptionDeleted(subscription, db) {
  await db.prepare(
    `UPDATE subscriptions SET status = 'canceled', updated_at = datetime('now')
     WHERE stripe_subscription_id = ?`
  ).bind(subscription.id).run();
}

async function handleSubscriptionUpdated(subscription, db) {
  const periodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null;

  const member = await getMemberByStripeId(db, subscription.customer);
  if (!member) return;

  const item = subscription.items?.data?.[0];
  const amountCents = item?.price?.unit_amount || 0;
  const priceId = item?.price?.id || null;

  await db.prepare(
    `INSERT INTO subscriptions (member_id, stripe_subscription_id, stripe_price_id, amount_cents, status, current_period_end)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(stripe_subscription_id) DO UPDATE SET
       status = excluded.status,
       amount_cents = excluded.amount_cents,
       stripe_price_id = excluded.stripe_price_id,
       current_period_end = excluded.current_period_end,
       updated_at = datetime('now')`
  ).bind(member.id, subscription.id, priceId, amountCents, subscription.status, periodEnd).run();
}

async function getMemberByStripeId(db, stripeCustomerId) {
  if (!stripeCustomerId) return null;
  return await db.prepare(
    'SELECT id FROM members WHERE stripe_customer_id = ?'
  ).bind(stripeCustomerId).first();
}

// Stripe webhook signature verification using Web Crypto API (no Node.js required)
async function verifyStripeSignature(payload, sigHeader, secret) {
  if (!sigHeader || !secret) throw new Error('Missing signature or secret');

  const parts = sigHeader.split(',').reduce((acc, part) => {
    const [k, v] = part.split('=');
    acc[k] = v;
    return acc;
  }, {});

  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) throw new Error('Malformed signature header');

  const signed = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed));
  const expected = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('');

  if (expected !== signature) throw new Error('Signature mismatch');

  // Reject webhooks older than 5 minutes
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp, 10)) > 300) {
    throw new Error('Timestamp too old');
  }

  return JSON.parse(payload);
}
