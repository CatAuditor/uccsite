// Automatic (transactional) emails composed as newsletters (docs/systems/email.md
// "Attached emails"). A newsletter row with kind = 'transactional' is never
// sent to the audience; an editor ATTACHES it to a trigger (petition signed,
// donation received) and the API Lambda sends the frozen copy to each person
// who acts, filling {first_name}-style placeholders. One email per trigger —
// and the petition trigger is one PER PETITION (`petition-thanks:<slug>`,
// db.petitionTrigger; no shared fallback — docs/systems/petition.md);
// attaching another replaces it; detaching returns to the built-in email in
// aws/api/emails.js. No two-person review (docs/pending-questions.md): the
// attach is audited `newsletter.attach` and reversible in one click.
import * as db from '@uccsite/db/newsletters';
import { listPetitions } from '@uccsite/db/petitions';
import { renderEmail } from '@uccsite/newsletter/render';
import { requireRole } from './auth';
import { withDb, withWriteTx, recordChange } from './data';
import { authorNameFor } from './newsletters';
import { config } from './config';

export const TRIGGERS = db.TRIGGERS;
const UUID_RE = /^[0-9a-f-]{36}$/;
const assertId = (id) => { if (!UUID_RE.test(String(id))) throw new Error('Bad email id'); return String(id); };
const clip = (v, n) => String(v ?? '').trim().slice(0, n);

// createTransactional(subject) → new draft id of kind 'transactional'.
export async function createTransactional(subject) {
  const s = await requireRole('editor');
  return withWriteTx(async (client) => {
    const fromName = await authorNameFor(client, s.email);
    const { theme } = await db.getDefaults(client);
    const id = await db.createNewsletter(client, { createdBy: s.email, fromName, subject: clip(subject, 200), theme, kind: 'transactional' });
    await recordChange(client, { actor: s.email, action: 'newsletter.create', entityType: 'newsletter', entityId: id, diff: { subject: clip(subject, 200), kind: 'transactional' } });
    return id;
  });
}

// slotsByTrigger(attachments) → { [trigger]: attachment + label/when }
function slotsByTrigger(attachments) {
  const out = {};
  for (const a of attachments) {
    const t = db.triggerOf(a.trigger);
    if (t) out[a.trigger] = { ...a, label: t.label, when: t.when };
  }
  return out;
}

// listSlots() → every slot with what is attached (or null) — the list page.
// The petition trigger expands to one slot per petition (in admin order);
// an attachment whose petition no longer exists is listed too, so it can be found.
export async function listSlots() {
  await requireRole('viewer');
  const { attachments, petitions } = await withDb(async (client) => ({ attachments: await db.listAttachments(client), petitions: await listPetitions(client, { ids: true }) }));
  const slots = slotsByTrigger(attachments);
  const out = [];
  for (const t of TRIGGERS) {
    if (!t.perPetition) { out.push({ ...t, attachment: slots[t.key] || null }); continue; }
    for (const p of petitions) {
      const key = db.petitionTrigger(p.slug);
      out.push({ ...db.triggerOf(key), petitionId: p.id, petitionStatus: p.status || 'draft', attachment: slots[key] || null });
    }
    for (const [key, a] of Object.entries(slots)) {
      if (key.startsWith(`${t.key}:`) && !out.some((s) => s.key === key)) out.push({ ...db.triggerOf(key), petitionId: null, petitionStatus: 'no petition', attachment: a });
    }
  }
  return out;
}

// transactionalState(id) → { attached: this email's attachment | null, slots }
export async function transactionalState(id) {
  await requireRole('viewer');
  const nid = assertId(id);
  const slots = slotsByTrigger(await withDb((client) => db.listAttachments(client)));
  const attached = Object.values(slots).find((a) => a.newsletterId === nid) || null;
  return { attached, slots };
}

// automaticEmails() → [{ id, subject, updatedAt }] — every kind='transactional' draft, newest first.
export async function automaticEmails() {
  await requireRole('viewer');
  const rows = await withDb((client) => db.listNewsletters(client, 200));
  return rows.filter((n) => n.kind === 'transactional').map((n) => ({ id: n.id, subject: n.subject, updatedAt: n.updatedAt }));
}

// transactionalSlot(trigger) → the trigger + its attachment (or null).
export async function transactionalSlot(trigger) {
  const t = db.triggerOf(trigger);
  if (!t) throw new Error('Unknown trigger');
  const slots = slotsByTrigger(await withDb((client) => db.listAttachments(client)));
  return { ...t, attachment: slots[t.key] || null };
}

// chooseEmail(trigger, id|'') → { label, builtIn }: the dropdown's action.
// '' = detach whatever is attached (built-in email again).
export async function chooseEmail(trigger, id) {
  const t = db.triggerOf(trigger);
  if (!t) throw new Error('Unknown trigger');
  if (!id) {
    const slot = await transactionalSlot(t.key);
    if (slot.attachment) await detachEmail(t.key, slot.attachment.newsletterId);
    return { label: '', builtIn: true };
  }
  await attachEmail(id, t.key);
  const n = await withDb((client) => db.getNewsletter(client, assertId(id)));
  return { label: n?.subject || '', builtIn: false };
}

// attachEmail(id, trigger) → { label, replaced }. Renders the saved draft
// exactly as a newsletter request would (same renderer, UTM campaign = the
// trigger key) and freezes it for the trigger. Refuses without a subject, a
// block, or a required placeholder (the donation receipt).
export async function attachEmail(id, trigger) {
  const s = await requireRole('editor');
  const nid = assertId(id);
  const t = db.triggerOf(trigger);
  if (!t) throw new Error('Pick when the email should be sent.');
  const n = await withDb((client) => db.getNewsletter(client, nid));
  if (!n) throw new Error('This email no longer exists.');
  if (n.kind !== 'transactional') throw new Error('Only an automatic email can be attached. Copy this newsletter as a new automatic email first.');
  if (!n.subject.trim()) throw new Error('Give the email a subject line first.');
  if (!n.blocks.length) throw new Error('Add at least one block first.');
  const { html, text } = renderEmail(n, { mode: 'auto', siteUrl: config.publicOrigin, campaign: t.key });
  for (const p of t.required) {
    if (!html.includes(`{${p}}`)) throw new Error(`This email must contain {${p}} somewhere in its text — it is where the ${p} goes.`);
  }
  return withWriteTx(async (client) => {
    const before = (await db.listAttachments(client)).find((a) => a.trigger === t.key) || null;
    await db.attachTransactional(client, { trigger: t.key, newsletterId: nid, subject: n.subject, html, text, attachedBy: s.email });
    await recordChange(client, {
      actor: s.email, action: 'newsletter.attach', entityType: 'newsletter', entityId: nid,
      diff: { trigger: t.key, replaced: before && before.newsletterId !== nid ? before.newsletterId : null },
    });
    console.log(`[admin] email ${nid} attached to ${t.key} by ${s.email}${before ? ` (replaced ${before.newsletterId})` : ''}`);
    return { label: t.when, replaced: Boolean(before && before.newsletterId !== nid) };
  });
}

// detachEmail(trigger, id) → the built-in email is used again for the trigger.
export async function detachEmail(trigger, id) {
  const s = await requireRole('editor');
  const nid = assertId(id);
  const t = db.triggerOf(trigger);
  if (!t) throw new Error('Unknown trigger.');
  return withWriteTx(async (client) => {
    const current = (await db.listAttachments(client)).find((a) => a.trigger === t.key) || null;
    if (!current || current.newsletterId !== nid) throw new Error('This email is not the one attached there any more — reload the page.');
    await db.detachTransactional(client, t.key);
    await recordChange(client, { actor: s.email, action: 'newsletter.detach', entityType: 'newsletter', entityId: nid, diff: { trigger: t.key } });
    console.log(`[admin] email ${nid} detached from ${t.key} by ${s.email}`);
  });
}
