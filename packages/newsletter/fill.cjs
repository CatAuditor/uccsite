'use strict';
// Placeholder filling for the automatic (transactional) emails, shared by the
// API Lambda (aws/api/emails.js — the real sends) and the admin's "Send me a
// test" (apps/admin/lib/newsletters.js — sample values), so an editor sees
// the same receipt the donor gets. CommonJS on purpose: aws/api is CJS and
// the admin imports it as a package (docs/systems/email.md "Attached emails").

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

// Editors paste drafts written as "[First name]" / "[$amount]" (Word-style
// brackets); those become {first_name} / {amount} when the key is known, so
// the pasted draft works without retyping. Anything else in brackets
// ("[CHECK: …]", "[website link]") is left exactly as typed.
function aliasTokens(text, known) {
  return String(text ?? '').replace(/\[\$?([A-Za-z][A-Za-z ]{0,30})\]/g, (m, k) => {
    const key = k.trim().toLowerCase().replace(/\s+/g, '_');
    return key in known ? `{${key}}` : m;
  });
}

// fillText(str, vars) → plain text / subject with {tokens} replaced verbatim;
// unknown tokens stay as typed.
function fillText(str, vars = {}) {
  return aliasTokens(str, vars).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

// fillHtml(html, { text, raw }) → html with {tokens} replaced: `text` values
// HTML-escaped, `raw` values inserted as markup. A raw token that is a
// paragraph of its own (`<p …>{receipt}</p>`, what a text block makes of a
// line that says only {receipt}) replaces the whole paragraph, so the receipt
// table is never nested inside a <p>. Unknown tokens stay as typed.
function fillHtml(html, { text = {}, raw = {} } = {}) {
  let out = aliasTokens(html, { ...text, ...raw });
  for (const k of Object.keys(raw)) out = out.replace(new RegExp(`<p\\b[^>]*>\\s*\\{${k}\\}\\s*</p>`, 'g'), `{${k}}`);
  return out.replace(/\{(\w+)\}/g, (m, k) => (k in raw ? String(raw[k]) : k in text ? escapeHtml(String(text[k])) : m));
}

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

const LEGAL = 'Utah Civic Compact is a 501(c)(4) social welfare organization. Contributions are not tax-deductible as charitable donations. Keep this email for your records.';
const CANCEL = 'To change or cancel your monthly membership, email info@utahciviccompact.org.';

// The receipt block: amount, type, date and the fixed 501(c)(4) line. Used by
// the built-in donation email and inserted for {receipt} in an attached one
// (an attached donation email is refused without that placeholder).
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

// The same receipt for the plain-text part.
function receiptText({ amount, recurring, date }) {
  return [
    `Amount: ${amount || '—'}${recurring ? ' / month' : ''}`,
    `Type: ${donationType(recurring)}`,
    `Date: ${date}`,
    '',
    LEGAL + (recurring ? ` ${CANCEL}` : ''),
  ].join('\n');
}

// sampleVars({ firstName }) → { text, raw } with a stand-in for EVERY
// placeholder any trigger uses, for the admin's test send of an automatic
// email (the real values are only known when someone signs or donates).
function sampleVars({ firstName = 'Sam', when = new Date() } = {}) {
  const amount = '$25.00'; const date = formatDate(when);
  return {
    text: {
      first_name: firstName, headline: 'Sample petition headline', project_name: 'Sample project',
      amount, type: donationType(false), date, receipt: receiptText({ amount, recurring: false, date }),
    },
    raw: { receipt: receiptHtml({ amount, recurring: false, date }) },
  };
}

module.exports = { escapeHtml, aliasTokens, fillText, fillHtml, formatAmount, formatDate, donationType, receiptHtml, receiptText, sampleVars };
