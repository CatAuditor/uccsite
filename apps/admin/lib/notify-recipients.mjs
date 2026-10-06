// Who gets the "publish request needs a review" email (pure, tested;
// docs/systems/admin.md "Publishing"). The reviewer list is the org's four
// admins by decision 2026-10-05 — a fixed list, not a Cognito lookup, so a
// mis-grouped account can never be mailed about a request.
import { when } from './when.mjs';

export const PUBLISH_REVIEWERS = [
  'jarom.gillins@utahciviccompact.org',
  'conner.radcliffe@utahciviccompact.org',
  'clark.dice@utahciviccompact.org',
  'kaden.payne@utahciviccompact.org',
];

// publishReviewRecipients({ requestedBy, role, envName, override }) → [] when
// nothing should be sent:
//  - an OWNER's request never mails anyone (owners approve their own);
//  - off prod the list is empty unless PUBLISH_NOTIFY_TO (comma list) is set,
//    so staging test editors never page the real admins;
//  - the requester is never mailed about their own request.
export function publishReviewRecipients({ requestedBy, role, envName, override }) {
  if (role === 'owner') return [];
  const list = override
    ? override.split(',').map((s) => s.trim()).filter(Boolean)
    : envName === 'prod' ? PUBLISH_REVIEWERS : [];
  const me = String(requestedBy || '').toLowerCase();
  return list.filter((e) => e.toLowerCase() !== me);
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

// publishRequestEmail({ requestedBy, note, changes, appOrigin }) → { subject, html }
export function publishRequestEmail({ requestedBy, note, changes, appOrigin }) {
  const n = changes.length;
  const items = changes.slice(0, 50).map((c) =>
    `<li><code>${escapeHtml(c.action)}</code>${c.entityId ? ` ${escapeHtml(c.entityId)}` : ''} — ${escapeHtml(c.actor)}, ${escapeHtml(when(c.at))}</li>`).join('');
  const more = n > 50 ? `<li>…and ${n - 50} more</li>` : '';
  return {
    subject: `Publish request from ${requestedBy} needs a review`,
    html: `<p><strong>${escapeHtml(requestedBy)}</strong> asked to publish ${n} saved change${n === 1 ? '' : 's'} to utahciviccompact.org.</p>`
      + (note ? `<blockquote>${escapeHtml(note)}</blockquote>` : '')
      + `<ul>${items}${more}</ul>`
      + `<p><a href="${escapeHtml(appOrigin)}/">Review it on Publish &amp; Status</a>. Nothing goes live until an owner or another editor approves it.</p>`,
  };
}
