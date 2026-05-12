export async function onRequestPost(context) {
  const { request, env } = context;

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (env.DB && !await checkRateLimit(env.DB, ip, 'subscribe', 5, 3600)) {
    return json({ error: 'Too many requests. Please try again later.' }, 429);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  const email = (body.email || '').trim().toLowerCase();
  const firstName = (body.firstName || '').trim().slice(0, 100);
  const lastName = (body.lastName || '').trim().slice(0, 100);
  const address = (body.address || '').trim().slice(0, 200);
  const zip = (body.zip || '').trim().slice(0, 10);

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'A valid email address is required' }, 400);
  }

  // Upsert — if they sign up again, update their info but don't error
  try {
    await env.DB.prepare(
      `INSERT INTO subscribers (email, first_name, last_name, address, zip)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         first_name = excluded.first_name,
         last_name  = excluded.last_name,
         address    = excluded.address,
         zip        = excluded.zip`
    )
      .bind(email, firstName || null, lastName || null, address || null, zip || null)
      .run();
  } catch (err) {
    console.error('DB error:', err);
    return json({ error: 'Could not save subscription' }, 500);
  }

  // Send welcome email via Resend
  if (env.RESEND_API_KEY) {
    const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : 'Welcome,';
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Utah Civic Compact <hello@utahciviccompact.org>',
        to: [email],
        subject: "You're in. Here's what that means.",
        html: buildWelcomeEmail(greeting),
      }),
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      console.error('Resend error:', errText);
      // Don't fail the signup if email fails — subscriber is saved
    }
  }

  return json({ ok: true });
}

function buildWelcomeEmail(greeting) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Welcome to Utah Civic Compact</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f0;font-family:'Georgia',serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f0;padding:40px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">

      <!-- Header -->
      <tr><td style="background:#1a3a2a;padding:36px 40px;">
        <p style="margin:0;color:#c8a84b;font-size:12px;letter-spacing:3px;text-transform:uppercase;">Utah Civic Compact</p>
        <h1 style="margin:8px 0 0;color:#ffffff;font-size:28px;font-weight:400;line-height:1.3;">
          Democracy is not a spectator sport.
        </h1>
      </td></tr>

      <!-- Body -->
      <tr><td style="padding:40px;">
        <p style="margin:0 0 20px;color:#2c2c2c;font-size:17px;line-height:1.7;">${greeting}</p>
        <p style="margin:0 0 20px;color:#2c2c2c;font-size:17px;line-height:1.7;">
          You didn't sign up for a newsletter. You joined a compact, and we mean that.
        </p>
        <p style="margin:0 0 20px;color:#2c2c2c;font-size:17px;line-height:1.7;">
          A lot of us looked at how politics works in Utah and decided we weren't okay with it. Not outraged. Just done waiting for it to fix itself. This is what we're building instead.
        </p>
        <p style="margin:0 0 20px;color:#2c2c2c;font-size:17px;line-height:1.7;">
          You're a founding member.
        </p>
        <p style="margin:0 0 32px;color:#2c2c2c;font-size:17px;line-height:1.7;">
          We're going to ask things of you. Not constantly, not with a donation button every third email. But when something matters and your voice can move it, we'll tell you. That's the deal. And it goes both ways. You need us, we'll show up.
        </p>
        <p style="margin:0 0 32px;color:#2c2c2c;font-size:17px;line-height:1.7;">
          Welcome. Tell someone.
        </p>
        <table cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
          <tr><td style="background:#1a3a2a;border-radius:4px;">
            <a href="https://utahciviccompact.org" style="display:inline-block;padding:14px 28px;color:#ffffff;font-family:sans-serif;font-size:15px;font-weight:600;text-decoration:none;letter-spacing:0.5px;">
              utahciviccompact.org &rarr;
            </a>
          </td></tr>
        </table>
        <table cellpadding="0" cellspacing="0">
          <tr><td style="background:#4a154b;border-radius:4px;">
            <a href="https://join.slack.com/t/utahciviccompact/shared_invite/zt-3xj2m02aq-BVUgI_0DshSwsEsfWy9DIg" style="display:inline-block;padding:14px 28px;color:#ffffff;font-family:sans-serif;font-size:15px;font-weight:600;text-decoration:none;letter-spacing:0.5px;">
              Join our Slack &rarr;
            </a>
          </td></tr>
        </table>
      </td></tr>

      <!-- Footer -->
      <tr><td style="background:#f5f5f0;padding:24px 40px;border-top:1px solid #e8e4d9;">
        <p style="margin:0;color:#888;font-family:sans-serif;font-size:12px;line-height:1.6;">
          Utah Civic Compact &middot; Salt Lake City, UT<br />
          You're getting this because you signed up at utahciviccompact.org.<br />
          <a href="https://utahciviccompact.org" style="color:#1a3a2a;">Unsubscribe</a>
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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