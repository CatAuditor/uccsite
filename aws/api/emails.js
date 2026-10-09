'use strict';
// Transactional email bodies (docs/systems/email.md "What is sent"): the
// petition thank-you and the donation thank-you. Pure — strings in, HTML
// out; routes.js / webhook.js resolve the copy, the links and the recipient,
// and sesSend() delivers. One layout so every message the site sends looks
// like the welcome email (whose body stays in routes.js, copy unchanged).
//
// These are the BUILT-IN bodies; an admin can replace either with an email
// composed in the admin (docs/systems/email.md "Attached emails"). Copy here
// is plain text, blank lines = paragraphs, with {first_name}, {headline}
// (petition) and {amount} (donation) substituted and HTML-escaped.
const { escapeHtml } = require('./lib');

const P = 'margin:0 0 20px;color:#2c2c2c;font-size:17px;line-height:1.7;';

// Admin text → safe HTML paragraphs with {placeholders} filled in.
function paragraphs(text, vars) {
  return String(text || '').split(/\n\s*\n/).map((para) => para.trim()).filter(Boolean)
    .map((para) => `<p style="${P}">${escapeHtml(fill(para, vars)).replace(/\n/g, '<br />')}</p>`)
    .join('\n        ');
}

function fill(text, vars) {
  return String(text).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

// Placeholders in an ATTACHED email (an admin-composed newsletter frozen as
// HTML — docs/systems/email.md "Attached emails"): text values are
// HTML-escaped, raw values (the receipt table) are inserted as markup, an
// unknown {token} stays as typed. fillText is the plain-text / subject twin.
function fillHtml(html, { text = {}, raw = {} } = {}) {
  return String(html || '').replace(/\{(\w+)\}/g, (m, k) => (k in raw ? String(raw[k]) : k in text ? escapeHtml(String(text[k])) : m));
}
function fillText(str, vars = {}) { return fill(str, vars); }

function button(url, label, { bg = '#1a3a2a', fg = '#ffffff' } = {}) {
  return `<table cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
          <tr><td style="background:${bg};border-radius:4px;">
            <a href="${escapeHtml(url)}" style="display:inline-block;padding:14px 28px;color:${fg};font-family:sans-serif;font-size:15px;font-weight:600;text-decoration:none;letter-spacing:0.5px;">
              ${escapeHtml(label)} &rarr;
            </a>
          </td></tr>
        </table>`;
}

// The shared frame: navy header with an eyebrow + heading, white body,
// cream footer. `heading` may carry our own <em> markup (petition headline).
function layout({ title, heading, bodyHtml, footerHtml }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f0;font-family:'Georgia',serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f0;padding:40px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">

      <!-- Header -->
      <tr><td style="background:#1a3a2a;padding:36px 40px;">
        <p style="margin:0;color:#c8a84b;font-size:12px;letter-spacing:3px;text-transform:uppercase;">Utah Civic Compact</p>
        <h1 style="margin:8px 0 0;color:#ffffff;font-size:26px;font-weight:400;line-height:1.3;">
          ${heading}
        </h1>
      </td></tr>

      <!-- Body -->
      <tr><td style="padding:40px;">
        ${bodyHtml}
      </td></tr>

      <!-- Footer -->
      <tr><td style="background:#f5f5f0;padding:24px 40px;border-top:1px solid #e8e4d9;">
        <p style="margin:0;color:#888;font-family:sans-serif;font-size:12px;line-height:1.6;">
          Utah Civic Compact &middot; Salt Lake City, UT<br />
          ${footerHtml}
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// Headline as the admin typed it: <em> is the only tag the hero allows, so
// keep <em> (as a gold accent in email) and strip everything else.
function headlineHtml(headline) {
  return escapeHtml(String(headline || '').replace(/<[^>]+>/g, (t) => (/^<\/?em>$/i.test(t) ? t : '')))
    .replace(/&lt;em&gt;/gi, '<em style="color:#c8a84b;font-style:normal;">').replace(/&lt;\/em&gt;/gi, '</em>');
}
const plain = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

// ── Petition thank-you ──────────────────────────────────────────────────────
// campaign: the live homepage.petition group when its slug is the one signed
// (routes.js petitionCampaign), else null → generic copy. project: { name,
// url } when the campaign is filed under a project (petition.project_slug).
const PETITION_SUBJECT = 'Thank you for signing: {headline}';
const PETITION_SUBJECT_GENERIC = 'Thank you for signing the petition';
const PETITION_BODY = `Hi {first_name},

Your name is on the record. Thank you.

A petition only works when the people who signed it are still there when the moment comes — when the agency answers, when the count is read into the record, when a vote is scheduled. We'll write when that happens and tell you exactly what would help. Not before.

Two things move the needle right now: send the petition to one person who should sign it, and if you can, chip in so we can carry this through the legislature.`;

function buildPetitionThanksEmail({ firstName, campaign, project, origin, unsubscribeUrl }) {
  const headline = plain(campaign?.headline);
  const vars = { first_name: firstName || 'there', headline };
  const subject = fill(headline ? PETITION_SUBJECT : PETITION_SUBJECT_GENERIC, vars);
  const body = paragraphs(PETITION_BODY, vars);
  const projectLine = project ? `
        <p style="${P}">This petition is part of our <a href="${escapeHtml(`${origin}${project.url}`)}" style="color:#1a3a2a;">${escapeHtml(project.name)}</a> project — the reports, records and coverage behind it live there.</p>` : '';
  const html = layout({
    title: subject,
    heading: headline ? headlineHtml(campaign.headline) : 'You signed. Thank you.',
    bodyHtml: `${body}${projectLine}
        ${button(`${origin}/petition`, campaign?.share_title || 'Share the petition')}
        ${button(`${origin}/petition-thanks`, 'Chip in', { bg: '#c8a84b', fg: '#1a3a2a' })}`,
    footerHtml: `You're getting this because you signed the petition at utahciviccompact.org. Signing adds you to our updates; you can leave any time.<br />
          <a href="${escapeHtml(unsubscribeUrl)}" style="color:#1a3a2a;">Unsubscribe</a>`,
  });
  return { subject, html };
}

// ── Donation thank-you ──────────────────────────────────────────────────────
// A receipt as well as a thank-you: amount, date, one-time vs monthly, and
// the fixed 501(c)(4) line — contributions are NOT tax-deductible, and the
// receipt must say so.
const DONATION_SUBJECT_ONETIME = 'Thank you for your {amount} donation';
const DONATION_SUBJECT_MONTHLY = 'Thank you — your {amount}/month membership is active';
const DONATION_BODY = `Hi {first_name},

Thank you. Your {amount} is what pays for records requests, the hours it takes to read what comes back, and the organizing that turns a finding into a fight. It goes to work right away.

We'll keep you posted on what it bought — plainly, and not every week.`;

function formatAmount(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n) || n <= 0) return '';
  return `$${(n / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Mountain-time date for the receipt.
function formatDate(when = new Date()) {
  return when.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Denver' });
}
const donationType = (recurring) => (recurring ? 'Monthly membership' : 'One-time donation');

// The receipt block: amount, type, date and the fixed 501(c)(4) line. Used by
// the built-in email and inserted for {receipt} in an attached one (an
// attached donation email is refused without that placeholder).
function receiptHtml({ amount, recurring, date }) {
  return `
        <table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 28px;border:1px solid #e8e4d9;border-radius:4px;font-family:sans-serif;font-size:14px;color:#2c2c2c;">
          <tr><td style="padding:12px 16px;border-bottom:1px solid #e8e4d9;">Amount</td><td style="padding:12px 16px;border-bottom:1px solid #e8e4d9;text-align:right;font-weight:700;">${escapeHtml(amount || '—')}${recurring ? ' / month' : ''}</td></tr>
          <tr><td style="padding:12px 16px;border-bottom:1px solid #e8e4d9;">Type</td><td style="padding:12px 16px;border-bottom:1px solid #e8e4d9;text-align:right;">${donationType(recurring)}</td></tr>
          <tr><td style="padding:12px 16px;">Date</td><td style="padding:12px 16px;text-align:right;">${escapeHtml(date)}</td></tr>
        </table>
        <p style="margin:0 0 28px;color:#555;font-family:sans-serif;font-size:13px;line-height:1.6;">
          Utah Civic Compact is a 501(c)(4) social welfare organization. Contributions are <strong>not</strong> tax-deductible as charitable donations. Keep this email for your records.${recurring ? ' To change or cancel your monthly membership, email <a href="mailto:info@utahciviccompact.org" style="color:#1a3a2a;">info@utahciviccompact.org</a>.' : ''}
        </p>`;
}

function buildDonationThanksEmail({ firstName, amountCents, recurring, origin, when = new Date() }) {
  const amount = formatAmount(amountCents);
  const vars = { first_name: firstName || 'there', amount: amount || 'gift' };
  const subject = fill(recurring ? DONATION_SUBJECT_MONTHLY : DONATION_SUBJECT_ONETIME, vars);
  const body = paragraphs(DONATION_BODY, vars);
  const date = formatDate(when);
  const receipt = receiptHtml({ amount, recurring, date });
  const html = layout({
    title: subject,
    heading: recurring ? 'You’re a member. Thank you.' : 'Thank you.',
    bodyHtml: `${body}${receipt}
        ${button(`${origin}/`, 'utahciviccompact.org')}`,
    footerHtml: `You're getting this because you ${recurring ? 'started a monthly membership' : 'donated'} at utahciviccompact.org.`,
  });
  return { subject, html };
}

module.exports = {
  buildPetitionThanksEmail, buildDonationThanksEmail, formatAmount, formatDate, donationType, receiptHtml, fillHtml, fillText,
  PETITION_SUBJECT, PETITION_BODY, DONATION_SUBJECT_ONETIME, DONATION_SUBJECT_MONTHLY, DONATION_BODY,
};
