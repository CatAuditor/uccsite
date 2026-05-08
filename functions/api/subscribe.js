export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  const email = (body.email || '').trim().toLowerCase();
  const firstName = (body.firstName || '').trim();
  const lastName = (body.lastName || '').trim();
  const address = (body.address || '').trim();
  const zip = (body.zip || '').trim();

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
    const greeting = firstName ? `Hi ${firstName},` : 'Welcome,';
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Utah Compact Caucus <hello@utahcompact.org>',
        to: [email],
        subject: "You're in — welcome to Utah Compact",
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
<title>Welcome to Utah Compact</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f0;font-family:'Georgia',serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f0;padding:40px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">

      <!-- Header -->
      <tr><td style="background:#1a3a2a;padding:36px 40px;">
        <p style="margin:0;color:#c8a84b;font-size:12px;letter-spacing:3px;text-transform:uppercase;">Utah Compact Caucus</p>
        <h1 style="margin:8px 0 0;color:#ffffff;font-size:28px;font-weight:400;line-height:1.3;">
          Democracy is not a spectator sport.
        </h1>
      </td></tr>

      <!-- Body -->
      <tr><td style="padding:40px;">
        <p style="margin:0 0 20px;color:#2c2c2c;font-size:17px;line-height:1.7;">${greeting}</p>
        <p style="margin:0 0 20px;color:#2c2c2c;font-size:17px;line-height:1.7;">
          You've joined the Utah Compact Caucus — a coalition of residents committed to honest government, genuine civic participation, and the long-term health of Utah democracy.
        </p>
        <p style="margin:0 0 20px;color:#2c2c2c;font-size:17px;line-height:1.7;">
          Here's what to expect from us:
        </p>
        <ul style="margin:0 0 24px;padding-left:24px;color:#2c2c2c;font-size:17px;line-height:2;">
          <li>Updates on the issues that matter most to Utah communities</li>
          <li>Action alerts when your voice is needed</li>
          <li>Resources to stay informed and engaged</li>
        </ul>
        <p style="margin:0 0 32px;color:#2c2c2c;font-size:17px;line-height:1.7;">
          We're glad you're here.
        </p>
        <table cellpadding="0" cellspacing="0">
          <tr><td style="background:#1a3a2a;border-radius:4px;">
            <a href="https://utahcompact.org" style="display:inline-block;padding:14px 28px;color:#ffffff;font-family:sans-serif;font-size:15px;font-weight:600;text-decoration:none;letter-spacing:0.5px;">
              Visit Utah Compact →
            </a>
          </td></tr>
        </table>
      </td></tr>

      <!-- Footer -->
      <tr><td style="background:#f5f5f0;padding:24px 40px;border-top:1px solid #e8e4d9;">
        <p style="margin:0;color:#888;font-family:sans-serif;font-size:12px;line-height:1.6;">
          Utah Compact Caucus · Salt Lake City, UT<br />
          You're receiving this because you signed up at utahcompact.org.<br />
          <a href="https://utahcompact.org" style="color:#1a3a2a;">Unsubscribe</a>
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
