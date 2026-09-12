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

  // Idempotency: Stripe retries on non-2xx and may redeliver within the replay window.
  try {
    const { meta } = await env.DB.prepare(
      'INSERT OR IGNORE INTO processed_events (id) VALUES (?)'
    ).bind(event.id).run();
    if (meta.changes === 0) {
      return ok({ received: true, duplicate: true });
    }
  } catch (err) {
    // Table missing (schema not migrated) — proceed without idempotency rather than dropping events.
    console.error('processed_events insert failed:', err?.message);
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
    // Allow a retry to reprocess this event.
    await env.DB.prepare('DELETE FROM processed_events WHERE id = ?').bind(event.id).run().catch(() => {});
    return new Response('Handler error', { status: 500 });
  }

  return ok({ received: true });
}

function ok(body) {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}

// ── Stripe object helpers (tolerate both pre- and post-2025 invoice shapes) ──

function invoiceSubscriptionId(invoice) {
  const v = invoice.subscription ?? invoice.parent?.subscription_details?.subscription;
  return typeof v === 'object' ? v?.id : v;
}

function invoicePaymentIntentId(invoice) {
  const v = invoice.payment_intent ?? invoice.payments?.data?.[0]?.payment?.payment_intent;
  return typeof v === 'object' ? v?.id : v;
}

async function upsertMember(db, { customerId, email, firstName, lastName, zip, newsletterOptIn }) {
  await db.prepare(
    `INSERT INTO members (stripe_customer_id, email, first_name, last_name, zip, newsletter_opt_in)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(stripe_customer_id) DO UPDATE SET
       email = excluded.email,
       first_name = COALESCE(excluded.first_name, first_name),
       last_name = COALESCE(excluded.last_name, last_name),
       zip = COALESCE(excluded.zip, zip),
       newsletter_opt_in = excluded.newsletter_opt_in`
  ).bind(customerId, email, firstName || null, lastName || null, zip || null, newsletterOptIn ? 1 : 0).run();
}

async function handleCheckoutComplete(session, db) {
  const customerId = session.customer;
  const email = session.customer_email || session.customer_details?.email;
  const { firstName, lastName, zip, newsletterOptIn, publicDonor } = session.metadata || {};

  if (!customerId) {
    // Should not happen: checkout sets customer_creation='always' for payment mode.
    console.warn(`checkout.session.completed ${session.id} has no customer; donation not recorded`);
    return;
  }

  if (email) {
    await upsertMember(db, { customerId, email, firstName, lastName, zip, newsletterOptIn: newsletterOptIn === '1' });
  }

  if (session.mode === 'payment' && session.payment_intent) {
    const member = await getMemberByStripeId(db, customerId);
    if (!member) {
      console.warn(`No member for customer ${customerId}; donation ${session.payment_intent} not recorded`);
      return;
    }
    const isPublic = publicDonor === '0' ? 0 : 1;
    await db.prepare(
      `INSERT INTO donations (member_id, stripe_payment_intent_id, amount_cents, public)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(stripe_payment_intent_id) DO NOTHING`
    ).bind(member.id, session.payment_intent, session.amount_total, isPublic).run();
  }
}

async function handleInvoicePaid(invoice, db) {
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) return;

  await db.prepare(
    `UPDATE subscriptions SET status = 'active', updated_at = datetime('now')
     WHERE stripe_subscription_id = ?`
  ).bind(subscriptionId).run();

  const paymentIntentId = invoicePaymentIntentId(invoice);
  if (paymentIntentId && invoice.amount_paid > 0) {
    const member = await getMemberByStripeId(db, invoice.customer);
    if (!member) {
      console.warn(`No member for customer ${invoice.customer}; recurring donation ${paymentIntentId} not recorded`);
      return;
    }
    // publicDonor is carried on subscription_data.metadata at checkout.
    const publicDonor = invoice.subscription_details?.metadata?.publicDonor
      ?? invoice.parent?.subscription_details?.metadata?.publicDonor;
    const isPublic = publicDonor === '0' ? 0 : 1;
    await db.prepare(
      `INSERT INTO donations (member_id, stripe_payment_intent_id, amount_cents, public)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(stripe_payment_intent_id) DO NOTHING`
    ).bind(member.id, paymentIntentId, invoice.amount_paid, isPublic).run();
  }
}

async function handlePaymentFailed(invoice, db) {
  const subscriptionId = invoiceSubscriptionId(invoice);
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
  if (!member) {
    console.warn(`No member for customer ${subscription.customer}; subscription ${subscription.id} not recorded`);
    return;
  }

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

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// Stripe webhook signature verification using Web Crypto API (no Node.js required)
async function verifyStripeSignature(payload, sigHeader, secret) {
  if (!sigHeader || !secret) throw new Error('Missing signature or secret');

  let timestamp;
  const signatures = [];
  for (const part of sigHeader.split(',')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k === 't') timestamp = v;
    else if (k === 'v1') signatures.push(v); // several during secret rotation
  }
  if (!timestamp || signatures.length === 0) throw new Error('Malformed signature header');

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

  if (!signatures.some(s => timingSafeEqual(expected, s))) throw new Error('Signature mismatch');

  // Reject webhooks older than 5 minutes
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp, 10)) > 300) {
    throw new Error('Timestamp too old');
  }

  return JSON.parse(payload);
}
